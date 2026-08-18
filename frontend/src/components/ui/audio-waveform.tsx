"use client";
import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";
export interface AudioWaveformIconHandle {
    startAnimation: () => void;
    stopAnimation: () => void;
}
interface AudioWaveformIconProps extends HTMLAttributes<HTMLDivElement> {
    size?: number;
}
const PATH_VARIANTS: Variants = {
    normal: {
        pathLength: 1,
        pathOffset: 0,
        opacity: 1,
    },
    animate: {
        pathLength: [0, 1],
        pathOffset: 0,
        opacity: [0.35, 1],
        transition: {
            duration: 0.8,
            ease: "easeInOut",
        },
    },
};
const AudioWaveformIcon = forwardRef<AudioWaveformIconHandle, AudioWaveformIconProps>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);
    useImperativeHandle(ref, () => {
        isControlledRef.current = true;
        return {
            startAnimation: () => controls.start("animate"),
            stopAnimation: () => controls.start("normal"),
        };
    });
    const handleMouseEnter = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current)
            onMouseEnter?.(event);
        else
            controls.start("animate");
    }, [controls, onMouseEnter]);
    const handleMouseLeave = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current)
            onMouseLeave?.(event);
        else
            controls.start("normal");
    }, [controls, onMouseLeave]);
    return (<div className={cn(className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
      <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
        <motion.path animate={controls} initial="normal" variants={PATH_VARIANTS} d="M2 13a2 2 0 0 0 2-2V7a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0V4a2 2 0 0 1 4 0v13a2 2 0 0 0 4 0v-4a2 2 0 0 1 2-2"/>
      </svg>
    </div>);
});
AudioWaveformIcon.displayName = "AudioWaveformIcon";
export { AudioWaveformIcon };
