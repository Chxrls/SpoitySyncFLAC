"use client";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import type { Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import { cn } from "@/lib/utils";
export interface TagPlusIconHandle {
    startAnimation: () => void;
    stopAnimation: () => void;
}
interface TagPlusIconProps extends HTMLAttributes<HTMLDivElement> {
    size?: number;
    animated?: boolean;
}
const TAG_VARIANTS: Variants = {
    normal: { pathLength: 1, opacity: 1 },
    animate: {
        pathLength: [0, 1],
        opacity: [0, 1],
        transition: { duration: 0.55, ease: "easeInOut" },
    },
};
const PLUS_VARIANTS: Variants = {
    normal: { scale: 1, rotate: 0 },
    animate: {
        scale: [0.55, 1.2, 1],
        rotate: [-90, 8, 0],
        transition: { duration: 0.5, ease: "backOut", delay: 0.12 },
    },
};
const DOT_VARIANTS: Variants = {
    normal: { scale: 1, opacity: 1 },
    animate: {
        scale: [1, 1.9, 1],
        opacity: [1, 0.55, 1],
        transition: { duration: 0.45, delay: 0.2 },
    },
};
const TagPlusIcon = forwardRef<TagPlusIconHandle, TagPlusIconProps>(({ onMouseEnter, onMouseLeave, className, size = 24, animated = true, ...props }, ref) => {
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
        if (!animated || isControlledRef.current)
            onMouseEnter?.(event);
        else
            void controls.start("animate");
    }, [animated, controls, onMouseEnter]);
    const handleMouseLeave = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!animated || isControlledRef.current)
            onMouseLeave?.(event);
        else
            void controls.start("normal");
    }, [animated, controls, onMouseLeave]);
    return <div className={cn("inline-flex items-center justify-center", className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
      <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <motion.path d="m16.5 6.5-3.914-3.914A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l1.79-1.79" variants={TAG_VARIANTS} initial="normal" animate={controls}/>
        <motion.g variants={PLUS_VARIANTS} initial="normal" animate={controls} style={{ transformOrigin: "19px 13px" }}>
          <path d="M16 13h6"/><path d="M19 10v6"/>
        </motion.g>
        <motion.circle cx="7.5" cy="7.5" r=".5" fill="currentColor" variants={DOT_VARIANTS} initial="normal" animate={controls} style={{ transformOrigin: "7.5px 7.5px" }}/>
      </svg>
    </div>;
});
TagPlusIcon.displayName = "TagPlusIcon";
export { TagPlusIcon };
