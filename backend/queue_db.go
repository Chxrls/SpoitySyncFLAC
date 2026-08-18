package backend

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	bolt "go.etcd.io/bbolt"
)

const (
	persistentQueueDBFileName  = "queue.db"
	persistentQueueItemsBucket = "DownloadQueueItems"
	persistentQueueMetaBucket  = "DownloadQueueMeta"
	persistentQueueOrderKey    = "order"
)

type persistentQueueStore struct {
	db *bolt.DB
}

type persistentQueueItem struct {
	ID  string
	Raw json.RawMessage
}

var (
	persistentQueueStoreMu sync.Mutex
	globalQueueStore       *persistentQueueStore
)

func openPersistentQueueStore(dbPath string) (*persistentQueueStore, error) {
	if err := os.MkdirAll(filepath.Dir(dbPath), 0o755); err != nil {
		return nil, fmt.Errorf("create queue database directory: %w", err)
	}

	db, err := bolt.Open(dbPath, 0o600, &bolt.Options{Timeout: time.Second})
	if err != nil {
		return nil, fmt.Errorf("open queue database: %w", err)
	}

	store := &persistentQueueStore{db: db}
	if err := db.Update(func(tx *bolt.Tx) error {
		if _, err := tx.CreateBucketIfNotExists([]byte(persistentQueueItemsBucket)); err != nil {
			return err
		}
		_, err := tx.CreateBucketIfNotExists([]byte(persistentQueueMetaBucket))
		return err
	}); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("initialize queue database: %w", err)
	}

	return store, nil
}

func (s *persistentQueueStore) close() error {
	if s == nil || s.db == nil {
		return nil
	}
	return s.db.Close()
}

func parsePersistentQueueItems(raw string) ([]persistentQueueItem, error) {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return nil, errors.New("queue payload is empty")
	}

	var entries []json.RawMessage
	if err := json.Unmarshal([]byte(trimmed), &entries); err != nil {
		return nil, fmt.Errorf("decode queue payload: %w", err)
	}
	if entries == nil {
		return nil, errors.New("queue payload must be a JSON array")
	}

	items := make([]persistentQueueItem, 0, len(entries))
	seen := make(map[string]struct{}, len(entries))
	for index, entry := range entries {
		var identity struct {
			ID string `json:"id"`
		}
		if err := json.Unmarshal(entry, &identity); err != nil {
			return nil, fmt.Errorf("decode queue item %d: %w", index, err)
		}
		identity.ID = strings.TrimSpace(identity.ID)
		if identity.ID == "" {
			return nil, fmt.Errorf("queue item %d has no id", index)
		}
		if len(identity.ID) > 1024 {
			return nil, fmt.Errorf("queue item %d id is too long", index)
		}
		if _, exists := seen[identity.ID]; exists {
			return nil, fmt.Errorf("duplicate queue item id %q", identity.ID)
		}
		seen[identity.ID] = struct{}{}

		compact := bytes.NewBuffer(make([]byte, 0, len(entry)))
		if err := json.Compact(compact, entry); err != nil {
			return nil, fmt.Errorf("compact queue item %d: %w", index, err)
		}
		items = append(items, persistentQueueItem{ID: identity.ID, Raw: compact.Bytes()})
	}

	return items, nil
}

func parsePersistentQueueOrder(raw string) ([]string, error) {
	var order []string
	if err := json.Unmarshal([]byte(raw), &order); err != nil {
		return nil, fmt.Errorf("decode queue order: %w", err)
	}
	if order == nil {
		return nil, errors.New("queue order must be a JSON array")
	}

	seen := make(map[string]struct{}, len(order))
	for index, id := range order {
		id = strings.TrimSpace(id)
		if id == "" {
			return nil, fmt.Errorf("queue order item %d has no id", index)
		}
		if _, exists := seen[id]; exists {
			return nil, fmt.Errorf("duplicate queue order id %q", id)
		}
		seen[id] = struct{}{}
		order[index] = id
	}
	return order, nil
}

func marshalPersistentQueueOrder(order []string) ([]byte, error) {
	encoded, err := json.Marshal(order)
	if err != nil {
		return nil, fmt.Errorf("encode queue order: %w", err)
	}
	return encoded, nil
}

func (s *persistentQueueStore) load() (string, error) {
	var payload string
	err := s.db.View(func(tx *bolt.Tx) error {
		itemsBucket := tx.Bucket([]byte(persistentQueueItemsBucket))
		metaBucket := tx.Bucket([]byte(persistentQueueMetaBucket))
		if itemsBucket == nil || metaBucket == nil {
			return errors.New("queue database buckets are missing")
		}

		rawOrder := metaBucket.Get([]byte(persistentQueueOrderKey))
		if rawOrder == nil {
			return nil
		}
		order, err := parsePersistentQueueOrder(string(rawOrder))
		if err != nil {
			return err
		}

		var result bytes.Buffer
		result.WriteByte('[')
		for index, id := range order {
			rawItem := itemsBucket.Get([]byte(id))
			if rawItem == nil {
				return fmt.Errorf("queue item %q referenced by the order is missing", id)
			}
			if !json.Valid(rawItem) {
				return fmt.Errorf("queue item %q contains invalid JSON", id)
			}
			if index > 0 {
				result.WriteByte(',')
			}
			result.Write(rawItem)
		}
		result.WriteByte(']')
		payload = result.String()
		return nil
	})
	if err != nil {
		return "", fmt.Errorf("load persistent download queue: %w", err)
	}
	return payload, nil
}

func (s *persistentQueueStore) replace(raw string) error {
	items, err := parsePersistentQueueItems(raw)
	if err != nil {
		return err
	}
	order := make([]string, 0, len(items))
	for _, item := range items {
		order = append(order, item.ID)
	}
	encodedOrder, err := marshalPersistentQueueOrder(order)
	if err != nil {
		return err
	}

	return s.db.Update(func(tx *bolt.Tx) error {
		if err := tx.DeleteBucket([]byte(persistentQueueItemsBucket)); err != nil && !errors.Is(err, bolt.ErrBucketNotFound) {
			return err
		}
		itemsBucket, err := tx.CreateBucket([]byte(persistentQueueItemsBucket))
		if err != nil {
			return err
		}
		metaBucket, err := tx.CreateBucketIfNotExists([]byte(persistentQueueMetaBucket))
		if err != nil {
			return err
		}
		for _, item := range items {
			if err := itemsBucket.Put([]byte(item.ID), item.Raw); err != nil {
				return err
			}
		}
		return metaBucket.Put([]byte(persistentQueueOrderKey), encodedOrder)
	})
}

func (s *persistentQueueStore) apply(upsertsRaw string, removedIDs []string, orderRaw string) error {
	upserts, err := parsePersistentQueueItems(upsertsRaw)
	if err != nil {
		return err
	}

	var order []string
	if strings.TrimSpace(orderRaw) != "" {
		order, err = parsePersistentQueueOrder(orderRaw)
		if err != nil {
			return err
		}
	}

	return s.db.Update(func(tx *bolt.Tx) error {
		itemsBucket, err := tx.CreateBucketIfNotExists([]byte(persistentQueueItemsBucket))
		if err != nil {
			return err
		}
		metaBucket, err := tx.CreateBucketIfNotExists([]byte(persistentQueueMetaBucket))
		if err != nil {
			return err
		}

		membershipChanged := false
		for _, id := range removedIDs {
			id = strings.TrimSpace(id)
			if id == "" {
				return errors.New("removed queue item id is empty")
			}
			if itemsBucket.Get([]byte(id)) != nil {
				membershipChanged = true
			}
			if err := itemsBucket.Delete([]byte(id)); err != nil {
				return err
			}
		}
		for _, item := range upserts {
			if itemsBucket.Get([]byte(item.ID)) == nil {
				membershipChanged = true
			}
			if err := itemsBucket.Put([]byte(item.ID), item.Raw); err != nil {
				return err
			}
		}

		if order == nil {
			if membershipChanged {
				return errors.New("queue membership changed without an updated order")
			}
			return nil
		}
		orderedIDs := make(map[string]struct{}, len(order))
		for _, id := range order {
			if itemsBucket.Get([]byte(id)) == nil {
				return fmt.Errorf("queue order references missing item %q", id)
			}
			orderedIDs[id] = struct{}{}
		}
		cursor := itemsBucket.Cursor()
		for key, _ := cursor.First(); key != nil; key, _ = cursor.Next() {
			if _, exists := orderedIDs[string(key)]; !exists {
				return errors.New("queue order does not contain every stored item")
			}
		}
		encodedOrder, err := marshalPersistentQueueOrder(order)
		if err != nil {
			return err
		}
		return metaBucket.Put([]byte(persistentQueueOrderKey), encodedOrder)
	})
}

func InitPersistentQueueDB() error {
	persistentQueueStoreMu.Lock()
	defer persistentQueueStoreMu.Unlock()
	if globalQueueStore != nil {
		return nil
	}

	dbPath, err := getPersistentQueueDBPath()
	if err != nil {
		return err
	}
	store, err := openPersistentQueueStore(dbPath)
	if err != nil {
		return err
	}
	globalQueueStore = store
	return nil
}

func getPersistentQueueDBPath() (string, error) {
	appDir, err := GetFFmpegDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(appDir, persistentQueueDBFileName), nil
}

func getPersistentQueueStore() (*persistentQueueStore, error) {
	if err := InitPersistentQueueDB(); err != nil {
		return nil, err
	}
	persistentQueueStoreMu.Lock()
	defer persistentQueueStoreMu.Unlock()
	if globalQueueStore == nil {
		return nil, errors.New("queue database is not initialized")
	}
	return globalQueueStore, nil
}

func ClosePersistentQueueDB() {
	persistentQueueStoreMu.Lock()
	defer persistentQueueStoreMu.Unlock()
	if globalQueueStore == nil {
		return
	}
	_ = globalQueueStore.close()
	globalQueueStore = nil
}

func LoadPersistentDownloadQueue() (string, error) {
	store, err := getPersistentQueueStore()
	if err != nil {
		return "", err
	}
	return store.load()
}

func ReplacePersistentDownloadQueue(raw string) error {
	store, err := getPersistentQueueStore()
	if err != nil {
		return err
	}
	return store.replace(raw)
}

func ApplyPersistentDownloadQueueChanges(upserts string, removedIDs []string, order string) error {
	store, err := getPersistentQueueStore()
	if err != nil {
		return err
	}
	return store.apply(upserts, removedIDs, order)
}
