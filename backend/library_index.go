package backend

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	libraryIndexDBFileName       = "library_index.db"
	libraryIndexEntriesBucket    = "LibraryIndexEntries"
	libraryIndexRootsBucket      = "LibraryIndexRoots"
	libraryIndexLevelFilename    = 1
	libraryIndexLevelMetadata    = 2
	libraryIndexMinimumAudioSize = int64(100 * 1024)
)

type libraryIndexEntry struct {
	RootKey          string `json:"root_key"`
	Path             string `json:"path"`
	PathKey          string `json:"path_key"`
	Filename         string `json:"filename"`
	SpotifyID        string `json:"spotify_id,omitempty"`
	ISRC             string `json:"isrc,omitempty"`
	Size             int64  `json:"size"`
	ModifiedUnixNano int64  `json:"modified_unix_nano"`
	MetadataIndexed  bool   `json:"metadata_indexed"`
}

type libraryIndexRootState struct {
	Root      string `json:"root"`
	RootKey   string `json:"root_key"`
	Level     int    `json:"level"`
	ScannedAt int64  `json:"scanned_at"`
}

type libraryPathSet map[string]struct{}

type libraryRootLookup struct {
	byFilename  map[string]libraryPathSet
	byISRC      map[string]libraryPathSet
	bySpotifyID map[string]libraryPathSet
}

type libraryIndexStore struct {
	db       *bolt.DB
	mu       sync.RWMutex
	ensureMu sync.Mutex
	entries  map[string]libraryIndexEntry
	roots    map[string]libraryIndexRootState
	lookups  map[string]*libraryRootLookup
}

type LibraryIndexLookupRequest struct {
	Mode      string
	SpotifyID string
	ISRC      string
	Filenames []string
}

var (
	libraryIndexStoreMu sync.Mutex
	globalLibraryIndex  *libraryIndexStore
)

func newLibraryRootLookup() *libraryRootLookup {
	return &libraryRootLookup{
		byFilename:  make(map[string]libraryPathSet),
		byISRC:      make(map[string]libraryPathSet),
		bySpotifyID: make(map[string]libraryPathSet),
	}
}

func normalizeLibraryPath(path string) (string, string, error) {
	path = NormalizePath(strings.TrimSpace(path))
	if path == "" {
		return "", "", errors.New("path is empty")
	}
	absPath, err := filepath.Abs(path)
	if err != nil {
		return "", "", err
	}
	absPath = filepath.Clean(absPath)
	key := absPath
	if runtime.GOOS == "windows" {
		key = strings.ToLower(key)
	}
	return absPath, key, nil
}

func normalizeLibraryFilename(filename string) string {
	filename = strings.TrimSpace(filepath.Base(filename))
	if runtime.GOOS == "windows" {
		return strings.ToLower(filename)
	}
	return filename
}

func normalizeLibraryISRC(isrc string) string {
	return strings.ToUpper(strings.TrimSpace(isrc))
}

func validSpotifyTrackID(value string) bool {
	if len(value) != 22 {
		return false
	}
	for index := 0; index < len(value); index++ {
		character := value[index]
		if (character < '0' || character > '9') && (character < 'A' || character > 'Z') && (character < 'a' || character > 'z') {
			return false
		}
	}
	return true
}

func firstLibraryIndexToken(value string) string {
	fields := strings.Fields(value)
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

func extractLibrarySpotifyTrackID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	if validSpotifyTrackID(value) {
		return value
	}

	const webPrefix = "open.spotify.com/track/"
	lowerValue := strings.ToLower(value)
	if index := strings.Index(lowerValue, webPrefix); index >= 0 {
		candidate := value[index+len(webPrefix):]
		candidate = firstLibraryIndexToken(candidate)
		candidate = strings.SplitN(candidate, "?", 2)[0]
		candidate = strings.SplitN(candidate, "#", 2)[0]
		candidate = strings.Trim(candidate, "/,;()[]{}<>")
		if validSpotifyTrackID(candidate) {
			return candidate
		}
	}

	const uriPrefix = "spotify:track:"
	if index := strings.Index(lowerValue, uriPrefix); index >= 0 {
		candidate := value[index+len(uriPrefix):]
		candidate = firstLibraryIndexToken(candidate)
		candidate = strings.Trim(candidate, "/,;()[]{}<>")
		if validSpotifyTrackID(candidate) {
			return candidate
		}
	}
	return ""
}

func normalizeLibrarySpotifyID(value string) string {
	return extractLibrarySpotifyTrackID(value)
}

func isLibraryIndexAudioFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".flac", ".mp3", ".m4a", ".mp4", ".m4b", ".aac", ".wav", ".aiff", ".aif", ".ogg", ".opus", ".ape", ".wv", ".mpc":
		return true
	default:
		return false
	}
}

func pathIsWithinLibraryRoot(root, path string) bool {
	relative, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func addLibraryPath(setMap map[string]libraryPathSet, identifier, pathKey string) {
	if identifier == "" || pathKey == "" {
		return
	}
	set := setMap[identifier]
	if set == nil {
		set = make(libraryPathSet)
		setMap[identifier] = set
	}
	set[pathKey] = struct{}{}
}

func removeLibraryPath(setMap map[string]libraryPathSet, identifier, pathKey string) {
	if identifier == "" || pathKey == "" {
		return
	}
	set := setMap[identifier]
	if set == nil {
		return
	}
	delete(set, pathKey)
	if len(set) == 0 {
		delete(setMap, identifier)
	}
}

func (s *libraryIndexStore) addEntryLocked(entry libraryIndexEntry) {
	if previous, exists := s.entries[entry.PathKey]; exists {
		s.removeEntryLocked(previous)
	}
	s.entries[entry.PathKey] = entry
	lookup := s.lookups[entry.RootKey]
	if lookup == nil {
		lookup = newLibraryRootLookup()
		s.lookups[entry.RootKey] = lookup
	}
	addLibraryPath(lookup.byFilename, normalizeLibraryFilename(entry.Filename), entry.PathKey)
	addLibraryPath(lookup.byISRC, normalizeLibraryISRC(entry.ISRC), entry.PathKey)
	addLibraryPath(lookup.bySpotifyID, normalizeLibrarySpotifyID(entry.SpotifyID), entry.PathKey)
}

func (s *libraryIndexStore) removeEntryLocked(entry libraryIndexEntry) {
	lookup := s.lookups[entry.RootKey]
	if lookup != nil {
		removeLibraryPath(lookup.byFilename, normalizeLibraryFilename(entry.Filename), entry.PathKey)
		removeLibraryPath(lookup.byISRC, normalizeLibraryISRC(entry.ISRC), entry.PathKey)
		removeLibraryPath(lookup.bySpotifyID, normalizeLibrarySpotifyID(entry.SpotifyID), entry.PathKey)
	}
	delete(s.entries, entry.PathKey)
}

func openLibraryIndexStore(dbPath string) (*libraryIndexStore, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("create library index directory: %w", err)
	}
	db, err := bolt.Open(dbPath, 0o600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, fmt.Errorf("open library index: %w", err)
	}
	store := &libraryIndexStore{
		db:      db,
		entries: make(map[string]libraryIndexEntry),
		roots:   make(map[string]libraryIndexRootState),
		lookups: make(map[string]*libraryRootLookup),
	}
	if err := db.Update(func(tx *bolt.Tx) error {
		if _, err := tx.CreateBucketIfNotExists([]byte(libraryIndexEntriesBucket)); err != nil {
			return err
		}
		_, err := tx.CreateBucketIfNotExists([]byte(libraryIndexRootsBucket))
		return err
	}); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize library index: %w", err)
	}
	if err := store.load(); err != nil {
		_ = db.Close()
		return nil, err
	}
	return store, nil
}

func (s *libraryIndexStore) load() error {
	return s.db.View(func(tx *bolt.Tx) error {
		entriesBucket := tx.Bucket([]byte(libraryIndexEntriesBucket))
		rootsBucket := tx.Bucket([]byte(libraryIndexRootsBucket))
		if entriesBucket == nil || rootsBucket == nil {
			return errors.New("library index buckets are missing")
		}
		if err := rootsBucket.ForEach(func(_, value []byte) error {
			var state libraryIndexRootState
			if err := json.Unmarshal(value, &state); err != nil || state.RootKey == "" {
				return nil
			}
			s.roots[state.RootKey] = state
			return nil
		}); err != nil {
			return err
		}
		return entriesBucket.ForEach(func(_, value []byte) error {
			var entry libraryIndexEntry
			if err := json.Unmarshal(value, &entry); err != nil || entry.PathKey == "" || entry.RootKey == "" {
				return nil
			}
			s.addEntryLocked(entry)
			return nil
		})
	})
}

func getLibraryIndexDBPath() (string, error) {
	appDir, err := GetFFmpegDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(appDir, libraryIndexDBFileName), nil
}

func InitLibraryIndexDB() error {
	libraryIndexStoreMu.Lock()
	defer libraryIndexStoreMu.Unlock()
	if globalLibraryIndex != nil {
		return nil
	}
	dbPath, err := getLibraryIndexDBPath()
	if err != nil {
		return err
	}
	store, err := openLibraryIndexStore(dbPath)
	if err != nil {
		return err
	}
	globalLibraryIndex = store
	return nil
}

func getLibraryIndexStore() (*libraryIndexStore, error) {
	if err := InitLibraryIndexDB(); err != nil {
		return nil, err
	}
	libraryIndexStoreMu.Lock()
	defer libraryIndexStoreMu.Unlock()
	if globalLibraryIndex == nil {
		return nil, errors.New("library index is not initialized")
	}
	return globalLibraryIndex, nil
}

func CloseLibraryIndexDB() {
	libraryIndexStoreMu.Lock()
	defer libraryIndexStoreMu.Unlock()
	if globalLibraryIndex == nil {
		return
	}
	_ = globalLibraryIndex.db.Close()
	globalLibraryIndex = nil
}

func collectLibraryIndexEntries(root, rootKey string, includeMetadata bool) ([]libraryIndexEntry, error) {
	entries := make([]libraryIndexEntry, 0)
	err := filepath.Walk(root, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil || info == nil || info.IsDir() || !isLibraryIndexAudioFile(path) || info.Size() <= libraryIndexMinimumAudioSize {
			return nil
		}
		normalizedPath, pathKey, err := normalizeLibraryPath(path)
		if err != nil {
			return nil
		}
		entries = append(entries, libraryIndexEntry{
			RootKey:          rootKey,
			Path:             normalizedPath,
			PathKey:          pathKey,
			Filename:         filepath.Base(normalizedPath),
			Size:             info.Size(),
			ModifiedUnixNano: info.ModTime().UnixNano(),
		})
		return nil
	})
	if err != nil {
		if os.IsNotExist(err) {
			return entries, nil
		}
		return nil, err
	}
	if !includeMetadata || len(entries) == 0 {
		return entries, nil
	}

	workers := runtime.NumCPU()
	if workers < 1 {
		workers = 1
	}
	if workers > len(entries) {
		workers = len(entries)
	}
	jobs := make(chan int, len(entries))
	var waitGroup sync.WaitGroup
	for worker := 0; worker < workers; worker++ {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			for index := range jobs {
				metadata, metadataErr := ExtractFullMetadataFromFile(entries[index].Path)
				entries[index].MetadataIndexed = true
				if metadataErr != nil {
					continue
				}
				entries[index].ISRC = normalizeLibraryISRC(metadata.ISRC)
				entries[index].SpotifyID = extractLibrarySpotifyTrackID(metadata.URL)
				if entries[index].SpotifyID == "" {
					entries[index].SpotifyID = extractLibrarySpotifyTrackID(metadata.Comment)
				}
			}
		}()
	}
	for index := range entries {
		jobs <- index
	}
	close(jobs)
	waitGroup.Wait()
	return entries, nil
}

func (s *libraryIndexStore) replaceRoot(root string, rootKey string, entries []libraryIndexEntry, level int) error {
	conflictingRootKeys := make(map[string]struct{})
	s.mu.RLock()
	for _, entry := range entries {
		if previous, exists := s.entries[entry.PathKey]; exists && previous.RootKey != rootKey {
			conflictingRootKeys[previous.RootKey] = struct{}{}
		}
	}
	s.mu.RUnlock()
	state := libraryIndexRootState{
		Root:      root,
		RootKey:   rootKey,
		Level:     level,
		ScannedAt: time.Now().Unix(),
	}
	if err := s.db.Update(func(tx *bolt.Tx) error {
		entriesBucket := tx.Bucket([]byte(libraryIndexEntriesBucket))
		rootsBucket := tx.Bucket([]byte(libraryIndexRootsBucket))
		if entriesBucket == nil || rootsBucket == nil {
			return errors.New("library index buckets are missing")
		}
		for conflictingRootKey := range conflictingRootKeys {
			if err := rootsBucket.Delete([]byte(conflictingRootKey)); err != nil {
				return err
			}
		}
		cursor := entriesBucket.Cursor()
		for key, value := cursor.First(); key != nil; key, value = cursor.Next() {
			var existing libraryIndexEntry
			if json.Unmarshal(value, &existing) == nil && existing.RootKey == rootKey {
				if err := cursor.Delete(); err != nil {
					return err
				}
			}
		}
		for _, entry := range entries {
			encoded, err := json.Marshal(entry)
			if err != nil {
				return err
			}
			if err := entriesBucket.Put([]byte(entry.PathKey), encoded); err != nil {
				return err
			}
		}
		encodedState, err := json.Marshal(state)
		if err != nil {
			return err
		}
		return rootsBucket.Put([]byte(rootKey), encodedState)
	}); err != nil {
		return err
	}

	s.mu.Lock()
	for conflictingRootKey := range conflictingRootKeys {
		delete(s.roots, conflictingRootKey)
	}
	for _, entry := range s.entries {
		if entry.RootKey == rootKey {
			s.removeEntryLocked(entry)
		}
	}
	for _, entry := range entries {
		s.addEntryLocked(entry)
	}
	s.roots[rootKey] = state
	s.mu.Unlock()
	return nil
}

func (s *libraryIndexStore) ensureRoot(root string, includeMetadata bool) (string, error) {
	root, rootKey, err := normalizeLibraryPath(root)
	if err != nil {
		return "", err
	}
	requiredLevel := libraryIndexLevelFilename
	if includeMetadata {
		requiredLevel = libraryIndexLevelMetadata
	}

	s.mu.RLock()
	state, exists := s.roots[rootKey]
	s.mu.RUnlock()
	if exists && state.Level >= requiredLevel {
		return rootKey, nil
	}

	s.ensureMu.Lock()
	defer s.ensureMu.Unlock()
	s.mu.RLock()
	state, exists = s.roots[rootKey]
	s.mu.RUnlock()
	if exists && state.Level >= requiredLevel {
		return rootKey, nil
	}

	modeLabel := "filenames"
	if includeMetadata {
		modeLabel = "metadata"
	}
	fmt.Printf("[LibraryIndex] Indexing %s for %s\n", modeLabel, root)
	entries, err := collectLibraryIndexEntries(root, rootKey, includeMetadata)
	if err != nil {
		return "", fmt.Errorf("index library root: %w", err)
	}
	s.mu.RLock()
	for index := range entries {
		previous, exists := s.entries[entries[index].PathKey]
		if !exists || previous.RootKey != rootKey || previous.Size != entries[index].Size || previous.ModifiedUnixNano != entries[index].ModifiedUnixNano {
			continue
		}
		if entries[index].SpotifyID == "" {
			entries[index].SpotifyID = previous.SpotifyID
		}
		if entries[index].ISRC == "" {
			entries[index].ISRC = previous.ISRC
		}
	}
	s.mu.RUnlock()
	if err := s.replaceRoot(root, rootKey, entries, requiredLevel); err != nil {
		return "", fmt.Errorf("persist library index: %w", err)
	}
	fmt.Printf("[LibraryIndex] Indexed %d audio files\n", len(entries))
	return rootKey, nil
}

func EnsureLibraryIndex(root string, includeMetadata bool) error {
	store, err := getLibraryIndexStore()
	if err != nil {
		return err
	}
	_, err = store.ensureRoot(root, includeMetadata)
	return err
}

func copyLibraryPathSet(paths libraryPathSet) []string {
	result := make([]string, 0, len(paths))
	for pathKey := range paths {
		result = append(result, pathKey)
	}
	sort.Strings(result)
	return result
}

func appendUniqueLibraryPaths(target []string, seen map[string]struct{}, paths libraryPathSet) []string {
	for _, pathKey := range copyLibraryPathSet(paths) {
		if _, exists := seen[pathKey]; exists {
			continue
		}
		seen[pathKey] = struct{}{}
		target = append(target, pathKey)
	}
	return target
}

func (s *libraryIndexStore) candidatePathKeys(rootKey string, request LibraryIndexLookupRequest) []string {
	s.mu.RLock()
	defer s.mu.RUnlock()
	lookup := s.lookups[rootKey]
	if lookup == nil {
		return nil
	}
	mode := normalizeExistingFileCheckMode(request.Mode)
	spotifyID := normalizeLibrarySpotifyID(request.SpotifyID)
	isrc := normalizeLibraryISRC(request.ISRC)
	seen := make(map[string]struct{})
	paths := make([]string, 0)
	if mode == "hybrid" && spotifyID != "" {
		paths = appendUniqueLibraryPaths(paths, seen, lookup.bySpotifyID[spotifyID])
	}
	if (mode == "isrc" || mode == "hybrid") && isrc != "" {
		paths = appendUniqueLibraryPaths(paths, seen, lookup.byISRC[isrc])
	}
	if mode == "filename" || mode == "hybrid" || (mode == "isrc" && isrc == "") {
		for _, filename := range request.Filenames {
			paths = appendUniqueLibraryPaths(paths, seen, lookup.byFilename[normalizeLibraryFilename(filename)])
		}
	}
	return paths
}

func (s *libraryIndexStore) removePathKey(pathKey string) {
	s.mu.RLock()
	entry, exists := s.entries[pathKey]
	s.mu.RUnlock()
	if !exists {
		return
	}
	if err := s.db.Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(libraryIndexEntriesBucket))
		if bucket == nil {
			return errors.New("library index entries bucket is missing")
		}
		return bucket.Delete([]byte(pathKey))
	}); err != nil {
		return
	}
	s.mu.Lock()
	s.removeEntryLocked(entry)
	s.mu.Unlock()
}

func FindExistingLibraryFile(root string, request LibraryIndexLookupRequest) (string, bool, error) {
	store, err := getLibraryIndexStore()
	if err != nil {
		return "", false, err
	}
	mode := normalizeExistingFileCheckMode(request.Mode)
	rootKey, err := store.ensureRoot(root, mode == "isrc" || mode == "hybrid")
	if err != nil {
		return "", false, err
	}
	for _, pathKey := range store.candidatePathKeys(rootKey, request) {
		store.mu.RLock()
		entry, exists := store.entries[pathKey]
		store.mu.RUnlock()
		if !exists {
			continue
		}
		info, statErr := os.Stat(entry.Path)
		if statErr == nil && !info.IsDir() && info.Size() > libraryIndexMinimumAudioSize {
			return entry.Path, true, nil
		}
		store.removePathKey(pathKey)
	}
	return "", false, nil
}

func (s *libraryIndexStore) upsertEntry(entry libraryIndexEntry) error {
	encoded, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	conflictingRootKey := ""
	s.mu.RLock()
	if previous, exists := s.entries[entry.PathKey]; exists && previous.RootKey != entry.RootKey {
		conflictingRootKey = previous.RootKey
	}
	s.mu.RUnlock()
	if err := s.db.Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(libraryIndexEntriesBucket))
		rootsBucket := tx.Bucket([]byte(libraryIndexRootsBucket))
		if bucket == nil || rootsBucket == nil {
			return errors.New("library index buckets are missing")
		}
		if conflictingRootKey != "" {
			if err := rootsBucket.Delete([]byte(conflictingRootKey)); err != nil {
				return err
			}
		}
		return bucket.Put([]byte(entry.PathKey), encoded)
	}); err != nil {
		return err
	}
	s.mu.Lock()
	if conflictingRootKey != "" {
		delete(s.roots, conflictingRootKey)
	}
	s.addEntryLocked(entry)
	s.mu.Unlock()
	return nil
}

func RegisterLibraryFile(root, path, spotifyID, isrc string) error {
	path, pathKey, err := normalizeLibraryPath(path)
	if err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if info.IsDir() || info.Size() <= libraryIndexMinimumAudioSize || !isLibraryIndexAudioFile(path) {
		return nil
	}
	if strings.TrimSpace(root) == "" {
		root = filepath.Dir(path)
	}
	root, rootKey, err := normalizeLibraryPath(root)
	if err != nil {
		return err
	}
	if !pathIsWithinLibraryRoot(root, path) {
		root = filepath.Dir(path)
		root, rootKey, err = normalizeLibraryPath(root)
		if err != nil {
			return err
		}
	}

	entry := libraryIndexEntry{
		RootKey:          rootKey,
		Path:             path,
		PathKey:          pathKey,
		Filename:         filepath.Base(path),
		SpotifyID:        normalizeLibrarySpotifyID(spotifyID),
		ISRC:             normalizeLibraryISRC(isrc),
		Size:             info.Size(),
		ModifiedUnixNano: info.ModTime().UnixNano(),
		MetadataIndexed:  true,
	}
	if entry.ISRC == "" || entry.SpotifyID == "" {
		metadata, metadataErr := ExtractFullMetadataFromFile(path)
		if metadataErr == nil {
			if entry.ISRC == "" {
				entry.ISRC = normalizeLibraryISRC(metadata.ISRC)
			}
			if entry.SpotifyID == "" {
				entry.SpotifyID = extractLibrarySpotifyTrackID(metadata.URL)
				if entry.SpotifyID == "" {
					entry.SpotifyID = extractLibrarySpotifyTrackID(metadata.Comment)
				}
			}
		}
	}
	store, err := getLibraryIndexStore()
	if err != nil {
		return err
	}
	return store.upsertEntry(entry)
}

func MoveLibraryIndexFile(oldPath, newPath string) error {
	_, oldPathKey, err := normalizeLibraryPath(oldPath)
	if err != nil {
		return err
	}
	newPath, newPathKey, err := normalizeLibraryPath(newPath)
	if err != nil {
		return err
	}
	store, err := getLibraryIndexStore()
	if err != nil {
		return err
	}
	store.mu.RLock()
	entry, exists := store.entries[oldPathKey]
	rootState := store.roots[entry.RootKey]
	store.mu.RUnlock()
	if !exists {
		return nil
	}
	if rootState.Root != "" && !pathIsWithinLibraryRoot(rootState.Root, newPath) {
		store.removePathKey(oldPathKey)
		return nil
	}
	info, err := os.Stat(newPath)
	if err != nil {
		store.removePathKey(oldPathKey)
		return nil
	}
	entry.Path = newPath
	entry.PathKey = newPathKey
	entry.Filename = filepath.Base(newPath)
	entry.Size = info.Size()
	entry.ModifiedUnixNano = info.ModTime().UnixNano()
	encoded, err := json.Marshal(entry)
	if err != nil {
		return err
	}
	if err := store.db.Update(func(tx *bolt.Tx) error {
		bucket := tx.Bucket([]byte(libraryIndexEntriesBucket))
		if bucket == nil {
			return errors.New("library index entries bucket is missing")
		}
		if err := bucket.Delete([]byte(oldPathKey)); err != nil {
			return err
		}
		return bucket.Put([]byte(newPathKey), encoded)
	}); err != nil {
		return err
	}
	store.mu.Lock()
	if previous, ok := store.entries[oldPathKey]; ok {
		store.removeEntryLocked(previous)
	}
	store.addEntryLocked(entry)
	store.mu.Unlock()
	return nil
}
