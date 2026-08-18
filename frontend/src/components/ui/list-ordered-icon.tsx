"use client";
import type { Transition, Variants } from "motion/react";
import { motion, useAnimation } from "motion/react";
import type { HTMLAttributes } from "react";
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { cn } from "@/lib/utils";
export interface ListOrderedIconHandle {
    startAnimation: () => void;
    stopAnimation: () => void;
}
interface ListOrderedIconProps extends HTMLAttributes<HTMLDivElement> {
    size?: number;
}
const LINE_TRANSITION: Transition = {
    duration: 0.3,
    ease: "easeInOut",
};
const LINE_VARIANTS: Variants = {
    normal: {
        pathLength: 1,
        opacity: 1,
    },
    animate: {
        pathLength: [0, 1],
        opacity: [0, 1],
    },
};
const ListOrderedIcon = forwardRef<ListOrderedIconHandle, ListOrderedIconProps>(({ onMouseEnter, onMouseLeave, className, size = 28, ...props }, ref) => {
    const controls = useAnimation();
    const isControlledRef = useRef(false);
    useImperativeHandle(ref, () => {
        isControlledRef.current = true;
        return {
            startAnimation: () => controls.start("animate"),
            stopAnimation: () => controls.start("normal"),
        };
    });
    const handleMouseEnter = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
            onMouseEnter?.(e);
        }
        else {
            controls.start("animate");
        }
    }, [controls, onMouseEnter]);
    const handleMouseLeave = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (isControlledRef.current) {
            onMouseLeave?.(e);
        }
        else {
            controls.start("normal");
        }
    }, [controls, onMouseLeave]);
    return (<div className={cn("flex items-center justify-center", className)} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave} {...props}>
      <svg fill="none" height={size} stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" viewBox="0 0 24 24" width={size} xmlns="http://www.w3.org/2000/svg">
        <motion.path animate={controls} d="M11 5h10" initial="normal" transition={LINE_TRANSITION} variants={LINE_VARIANTS}/>
        <motion.path animate={controls} d="M11 12h10" initial="normal" transition={{ ...LINE_TRANSITION, delay: 0.1 }} variants={LINE_VARIANTS}/>
        <motion.path animate={controls} d="M11 19h10" initial="normal" transition={{ ...LINE_TRANSITION, delay: 0.2 }} variants={LINE_VARIANTS}/>
        <path d="M4 4h1v5"/>
        <path d="M4 9h2"/>
        <path d="M6.5 20H3.4c0-1 2.6-1.925 2.6-3.5a1.5 1.5 0 0 0-2.6-1.02"/>
      </svg>
    </div>);
});
ListOrderedIcon.displayName = "ListOrderedIcon";
export { ListOrderedIcon };
