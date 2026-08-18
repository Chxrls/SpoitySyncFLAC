export const BASE_COLOR_NAMES = ["neutral", "stone", "zinc", "mauve", "olive", "mist", "taupe"] as const;
export const ACCENT_COLOR_NAMES = ["amber", "blue", "cyan", "emerald", "fuchsia", "green", "indigo", "lime", "orange", "pink", "purple", "red", "rose", "sky", "teal", "violet", "yellow"] as const;
export type BaseColorName = (typeof BASE_COLOR_NAMES)[number];
export type AccentColorName = (typeof ACCENT_COLOR_NAMES)[number];
export type ThemeName = BaseColorName | AccentColorName;
export interface Theme {
    name: ThemeName;
    label: string;
    cssVars: {
        light: Record<string, string>;
        dark: Record<string, string>;
    };
}
export interface BaseColor extends Theme {
    name: BaseColorName;
}
const baseLightColors: Record<string, string> = {
    background: "oklch(1 0 0)",
    foreground: "oklch(0.145 0 0)",
    card: "oklch(1 0 0)",
    "card-foreground": "oklch(0.145 0 0)",
    popover: "oklch(1 0 0)",
    "popover-foreground": "oklch(0.145 0 0)",
    primary: "oklch(0.205 0 0)",
    "primary-foreground": "oklch(0.985 0 0)",
    secondary: "oklch(0.97 0 0)",
    "secondary-foreground": "oklch(0.205 0 0)",
    muted: "oklch(0.97 0 0)",
    "muted-foreground": "oklch(0.556 0 0)",
    accent: "oklch(0.97 0 0)",
    "accent-foreground": "oklch(0.205 0 0)",
    destructive: "oklch(0.577 0.245 27.325)",
    border: "oklch(0.922 0 0)",
    input: "oklch(0.922 0 0)",
    ring: "oklch(0.708 0 0)",
};
const baseDarkColors: Record<string, string> = {
    background: "oklch(0.145 0 0)",
    foreground: "oklch(0.985 0 0)",
    card: "oklch(0.205 0 0)",
    "card-foreground": "oklch(0.985 0 0)",
    popover: "oklch(0.205 0 0)",
    "popover-foreground": "oklch(0.985 0 0)",
    primary: "oklch(0.922 0 0)",
    "primary-foreground": "oklch(0.205 0 0)",
    secondary: "oklch(0.269 0 0)",
    "secondary-foreground": "oklch(0.985 0 0)",
    muted: "oklch(0.269 0 0)",
    "muted-foreground": "oklch(0.708 0 0)",
    accent: "oklch(0.269 0 0)",
    "accent-foreground": "oklch(0.985 0 0)",
    destructive: "oklch(0.704 0.191 22.216)",
    border: "oklch(1 0 0 / 10%)",
    input: "oklch(1 0 0 / 15%)",
    ring: "oklch(0.556 0 0)",
};
function createBaseColor(name: BaseColorName, label: string, cssVars: Theme["cssVars"]): BaseColor {
    return { name, label, cssVars };
}
export const baseColors: BaseColor[] = [
    createBaseColor("neutral", "Neutral", {
        light: baseLightColors,
        dark: baseDarkColors,
    }),
    createBaseColor("stone", "Stone", {
        light: {
            background: "oklch(1 0 0)",
            foreground: "oklch(0.147 0.004 49.25)",
            card: "oklch(1 0 0)",
            "card-foreground": "oklch(0.147 0.004 49.25)",
            popover: "oklch(1 0 0)",
            "popover-foreground": "oklch(0.147 0.004 49.25)",
            primary: "oklch(0.216 0.006 56.043)",
            "primary-foreground": "oklch(0.985 0.001 106.423)",
            secondary: "oklch(0.97 0.001 106.424)",
            "secondary-foreground": "oklch(0.216 0.006 56.043)",
            muted: "oklch(0.97 0.001 106.424)",
            "muted-foreground": "oklch(0.553 0.013 58.071)",
            accent: "oklch(0.97 0.001 106.424)",
            "accent-foreground": "oklch(0.216 0.006 56.043)",
            destructive: "oklch(0.577 0.245 27.325)",
            border: "oklch(0.923 0.003 48.717)",
            input: "oklch(0.923 0.003 48.717)",
            ring: "oklch(0.709 0.01 56.259)",
        },
        dark: {
            background: "oklch(0.147 0.004 49.25)",
            foreground: "oklch(0.985 0.001 106.423)",
            card: "oklch(0.216 0.006 56.043)",
            "card-foreground": "oklch(0.985 0.001 106.423)",
            popover: "oklch(0.216 0.006 56.043)",
            "popover-foreground": "oklch(0.985 0.001 106.423)",
            primary: "oklch(0.923 0.003 48.717)",
            "primary-foreground": "oklch(0.216 0.006 56.043)",
            secondary: "oklch(0.268 0.007 34.298)",
            "secondary-foreground": "oklch(0.985 0.001 106.423)",
            muted: "oklch(0.268 0.007 34.298)",
            "muted-foreground": "oklch(0.709 0.01 56.259)",
            accent: "oklch(0.268 0.007 34.298)",
            "accent-foreground": "oklch(0.985 0.001 106.423)",
            destructive: "oklch(0.704 0.191 22.216)",
            border: "oklch(1 0 0 / 10%)",
            input: "oklch(1 0 0 / 15%)",
            ring: "oklch(0.553 0.013 58.071)",
        },
    }),
    createBaseColor("zinc", "Zinc", {
        light: {
            background: "oklch(1 0 0)",
            foreground: "oklch(0.141 0.005 285.823)",
            card: "oklch(1 0 0)",
            "card-foreground": "oklch(0.141 0.005 285.823)",
            popover: "oklch(1 0 0)",
            "popover-foreground": "oklch(0.141 0.005 285.823)",
            primary: "oklch(0.21 0.006 285.885)",
            "primary-foreground": "oklch(0.985 0 0)",
            secondary: "oklch(0.967 0.001 286.375)",
            "secondary-foreground": "oklch(0.21 0.006 285.885)",
            muted: "oklch(0.967 0.001 286.375)",
            "muted-foreground": "oklch(0.552 0.016 285.938)",
            accent: "oklch(0.967 0.001 286.375)",
            "accent-foreground": "oklch(0.21 0.006 285.885)",
            destructive: "oklch(0.577 0.245 27.325)",
            border: "oklch(0.92 0.004 286.32)",
            input: "oklch(0.92 0.004 286.32)",
            ring: "oklch(0.705 0.015 286.067)",
        },
        dark: {
            background: "oklch(0.141 0.005 285.823)",
            foreground: "oklch(0.985 0 0)",
            card: "oklch(0.21 0.006 285.885)",
            "card-foreground": "oklch(0.985 0 0)",
            popover: "oklch(0.21 0.006 285.885)",
            "popover-foreground": "oklch(0.985 0 0)",
            primary: "oklch(0.92 0.004 286.32)",
            "primary-foreground": "oklch(0.21 0.006 285.885)",
            secondary: "oklch(0.274 0.006 286.033)",
            "secondary-foreground": "oklch(0.985 0 0)",
            muted: "oklch(0.274 0.006 286.033)",
            "muted-foreground": "oklch(0.705 0.015 286.067)",
            accent: "oklch(0.274 0.006 286.033)",
            "accent-foreground": "oklch(0.985 0 0)",
            destructive: "oklch(0.704 0.191 22.216)",
            border: "oklch(1 0 0 / 10%)",
            input: "oklch(1 0 0 / 15%)",
            ring: "oklch(0.552 0.016 285.938)",
        },
    }),
    createBaseColor("mauve", "Mauve", {
        light: {
            background: "oklch(1 0 0)",
            foreground: "oklch(0.145 0.008 326)",
            card: "oklch(1 0 0)",
            "card-foreground": "oklch(0.145 0.008 326)",
            popover: "oklch(1 0 0)",
            "popover-foreground": "oklch(0.145 0.008 326)",
            primary: "oklch(0.212 0.019 322.12)",
            "primary-foreground": "oklch(0.985 0 0)",
            secondary: "oklch(0.96 0.003 325.6)",
            "secondary-foreground": "oklch(0.212 0.019 322.12)",
            muted: "oklch(0.96 0.003 325.6)",
            "muted-foreground": "oklch(0.542 0.034 322.5)",
            accent: "oklch(0.96 0.003 325.6)",
            "accent-foreground": "oklch(0.212 0.019 322.12)",
            destructive: "oklch(0.577 0.245 27.325)",
            border: "oklch(0.922 0.005 325.62)",
            input: "oklch(0.922 0.005 325.62)",
            ring: "oklch(0.711 0.019 323.02)",
        },
        dark: {
            background: "oklch(0.145 0.008 326)",
            foreground: "oklch(0.985 0 0)",
            card: "oklch(0.212 0.019 322.12)",
            "card-foreground": "oklch(0.985 0 0)",
            popover: "oklch(0.212 0.019 322.12)",
            "popover-foreground": "oklch(0.985 0 0)",
            primary: "oklch(0.922 0.005 325.62)",
            "primary-foreground": "oklch(0.212 0.019 322.12)",
            secondary: "oklch(0.263 0.024 320.12)",
            "secondary-foreground": "oklch(0.985 0 0)",
            muted: "oklch(0.263 0.024 320.12)",
            "muted-foreground": "oklch(0.711 0.019 323.02)",
            accent: "oklch(0.263 0.024 320.12)",
            "accent-foreground": "oklch(0.985 0 0)",
            destructive: "oklch(0.704 0.191 22.216)",
            border: "oklch(1 0 0 / 10%)",
            input: "oklch(1 0 0 / 15%)",
            ring: "oklch(0.542 0.034 322.5)",
        },
    }),
    createBaseColor("olive", "Olive", {
        light: {
            background: "oklch(1 0 0)",
            foreground: "oklch(0.153 0.006 107.1)",
            card: "oklch(1 0 0)",
            "card-foreground": "oklch(0.153 0.006 107.1)",
            popover: "oklch(1 0 0)",
            "popover-foreground": "oklch(0.153 0.006 107.1)",
            primary: "oklch(0.228 0.013 107.4)",
            "primary-foreground": "oklch(0.988 0.003 106.5)",
            secondary: "oklch(0.966 0.005 106.5)",
            "secondary-foreground": "oklch(0.228 0.013 107.4)",
            muted: "oklch(0.966 0.005 106.5)",
            "muted-foreground": "oklch(0.58 0.031 107.3)",
            accent: "oklch(0.966 0.005 106.5)",
            "accent-foreground": "oklch(0.228 0.013 107.4)",
            destructive: "oklch(0.577 0.245 27.325)",
            border: "oklch(0.93 0.007 106.5)",
            input: "oklch(0.93 0.007 106.5)",
            ring: "oklch(0.737 0.021 106.9)",
        },
        dark: {
            background: "oklch(0.153 0.006 107.1)",
            foreground: "oklch(0.988 0.003 106.5)",
            card: "oklch(0.228 0.013 107.4)",
            "card-foreground": "oklch(0.988 0.003 106.5)",
            popover: "oklch(0.228 0.013 107.4)",
            "popover-foreground": "oklch(0.988 0.003 106.5)",
            primary: "oklch(0.93 0.007 106.5)",
            "primary-foreground": "oklch(0.228 0.013 107.4)",
            secondary: "oklch(0.286 0.016 107.4)",
            "secondary-foreground": "oklch(0.988 0.003 106.5)",
            muted: "oklch(0.286 0.016 107.4)",
            "muted-foreground": "oklch(0.737 0.021 106.9)",
            accent: "oklch(0.286 0.016 107.4)",
            "accent-foreground": "oklch(0.988 0.003 106.5)",
            destructive: "oklch(0.704 0.191 22.216)",
            border: "oklch(1 0 0 / 10%)",
            input: "oklch(1 0 0 / 15%)",
            ring: "oklch(0.58 0.031 107.3)",
        },
    }),
    createBaseColor("mist", "Mist", {
        light: {
            background: "oklch(1 0 0)",
            foreground: "oklch(0.148 0.004 228.8)",
            card: "oklch(1 0 0)",
            "card-foreground": "oklch(0.148 0.004 228.8)",
            popover: "oklch(1 0 0)",
            "popover-foreground": "oklch(0.148 0.004 228.8)",
            primary: "oklch(0.218 0.008 223.9)",
            "primary-foreground": "oklch(0.987 0.002 197.1)",
            secondary: "oklch(0.963 0.002 197.1)",
            "secondary-foreground": "oklch(0.218 0.008 223.9)",
            muted: "oklch(0.963 0.002 197.1)",
            "muted-foreground": "oklch(0.56 0.021 213.5)",
            accent: "oklch(0.963 0.002 197.1)",
            "accent-foreground": "oklch(0.218 0.008 223.9)",
            destructive: "oklch(0.577 0.245 27.325)",
            border: "oklch(0.925 0.005 214.3)",
            input: "oklch(0.925 0.005 214.3)",
            ring: "oklch(0.723 0.014 214.4)",
        },
        dark: {
            background: "oklch(0.148 0.004 228.8)",
            foreground: "oklch(0.987 0.002 197.1)",
            card: "oklch(0.218 0.008 223.9)",
            "card-foreground": "oklch(0.987 0.002 197.1)",
            popover: "oklch(0.218 0.008 223.9)",
            "popover-foreground": "oklch(0.987 0.002 197.1)",
            primary: "oklch(0.925 0.005 214.3)",
            "primary-foreground": "oklch(0.218 0.008 223.9)",
            secondary: "oklch(0.275 0.011 216.9)",
            "secondary-foreground": "oklch(0.987 0.002 197.1)",
            muted: "oklch(0.275 0.011 216.9)",
            "muted-foreground": "oklch(0.723 0.014 214.4)",
            accent: "oklch(0.275 0.011 216.9)",
            "accent-foreground": "oklch(0.987 0.002 197.1)",
            destructive: "oklch(0.704 0.191 22.216)",
            border: "oklch(1 0 0 / 10%)",
            input: "oklch(1 0 0 / 15%)",
            ring: "oklch(0.56 0.021 213.5)",
        },
    }),
    createBaseColor("taupe", "Taupe", {
        light: {
            background: "oklch(1 0 0)",
            foreground: "oklch(0.147 0.004 49.3)",
            card: "oklch(1 0 0)",
            "card-foreground": "oklch(0.147 0.004 49.3)",
            popover: "oklch(1 0 0)",
            "popover-foreground": "oklch(0.147 0.004 49.3)",
            primary: "oklch(0.214 0.009 43.1)",
            "primary-foreground": "oklch(0.986 0.002 67.8)",
            secondary: "oklch(0.96 0.002 17.2)",
            "secondary-foreground": "oklch(0.214 0.009 43.1)",
            muted: "oklch(0.96 0.002 17.2)",
            "muted-foreground": "oklch(0.547 0.021 43.1)",
            accent: "oklch(0.96 0.002 17.2)",
            "accent-foreground": "oklch(0.214 0.009 43.1)",
            destructive: "oklch(0.577 0.245 27.325)",
            border: "oklch(0.922 0.005 34.3)",
            input: "oklch(0.922 0.005 34.3)",
            ring: "oklch(0.714 0.014 41.2)",
        },
        dark: {
            background: "oklch(0.147 0.004 49.3)",
            foreground: "oklch(0.986 0.002 67.8)",
            card: "oklch(0.214 0.009 43.1)",
            "card-foreground": "oklch(0.986 0.002 67.8)",
            popover: "oklch(0.214 0.009 43.1)",
            "popover-foreground": "oklch(0.986 0.002 67.8)",
            primary: "oklch(0.922 0.005 34.3)",
            "primary-foreground": "oklch(0.214 0.009 43.1)",
            secondary: "oklch(0.268 0.011 36.5)",
            "secondary-foreground": "oklch(0.986 0.002 67.8)",
            muted: "oklch(0.268 0.011 36.5)",
            "muted-foreground": "oklch(0.714 0.014 41.2)",
            accent: "oklch(0.268 0.011 36.5)",
            "accent-foreground": "oklch(0.986 0.002 67.8)",
            destructive: "oklch(0.704 0.191 22.216)",
            border: "oklch(1 0 0 / 10%)",
            input: "oklch(1 0 0 / 15%)",
            ring: "oklch(0.547 0.021 43.1)",
        },
    }),
];
interface PrimaryColors {
    light: {
        primary: string;
        "primary-foreground": string;
    };
    dark: {
        primary: string;
        "primary-foreground": string;
    };
}
const primaryColors: Record<AccentColorName, PrimaryColors> = {
    amber: {
        light: {
            primary: "oklch(0.555 0.163 48.998)",
            "primary-foreground": "oklch(0.987 0.022 95.277)",
        },
        dark: {
            primary: "oklch(0.473 0.137 46.201)",
            "primary-foreground": "oklch(0.987 0.022 95.277)",
        },
    },
    blue: {
        light: {
            primary: "oklch(0.488 0.243 264.376)",
            "primary-foreground": "oklch(0.97 0.014 254.604)",
        },
        dark: {
            primary: "oklch(0.424 0.199 265.638)",
            "primary-foreground": "oklch(0.97 0.014 254.604)",
        },
    },
    cyan: {
        light: {
            primary: "oklch(0.52 0.105 223.128)",
            "primary-foreground": "oklch(0.984 0.019 200.873)",
        },
        dark: {
            primary: "oklch(0.45 0.085 224.283)",
            "primary-foreground": "oklch(0.984 0.019 200.873)",
        },
    },
    emerald: {
        light: {
            primary: "oklch(0.508 0.118 165.612)",
            "primary-foreground": "oklch(0.979 0.021 166.113)",
        },
        dark: {
            primary: "oklch(0.432 0.095 166.913)",
            "primary-foreground": "oklch(0.979 0.021 166.113)",
        },
    },
    fuchsia: {
        light: {
            primary: "oklch(0.518 0.253 323.949)",
            "primary-foreground": "oklch(0.977 0.017 320.058)",
        },
        dark: {
            primary: "oklch(0.452 0.211 324.591)",
            "primary-foreground": "oklch(0.977 0.017 320.058)",
        },
    },
    green: {
        light: {
            primary: "oklch(0.527 0.154 150.069)",
            "primary-foreground": "oklch(0.982 0.018 155.826)",
        },
        dark: {
            primary: "oklch(0.448 0.119 151.328)",
            "primary-foreground": "oklch(0.982 0.018 155.826)",
        },
    },
    indigo: {
        light: {
            primary: "oklch(0.457 0.24 277.023)",
            "primary-foreground": "oklch(0.962 0.018 272.314)",
        },
        dark: {
            primary: "oklch(0.398 0.195 277.366)",
            "primary-foreground": "oklch(0.962 0.018 272.314)",
        },
    },
    lime: {
        light: {
            primary: "oklch(0.841 0.238 128.85)",
            "primary-foreground": "oklch(0.405 0.101 131.063)",
        },
        dark: {
            primary: "oklch(0.768 0.233 130.85)",
            "primary-foreground": "oklch(0.405 0.101 131.063)",
        },
    },
    orange: {
        light: {
            primary: "oklch(0.553 0.195 38.402)",
            "primary-foreground": "oklch(0.98 0.016 73.684)",
        },
        dark: {
            primary: "oklch(0.47 0.157 37.304)",
            "primary-foreground": "oklch(0.98 0.016 73.684)",
        },
    },
    pink: {
        light: {
            primary: "oklch(0.525 0.223 3.958)",
            "primary-foreground": "oklch(0.971 0.014 343.198)",
        },
        dark: {
            primary: "oklch(0.459 0.187 3.815)",
            "primary-foreground": "oklch(0.971 0.014 343.198)",
        },
    },
    purple: {
        light: {
            primary: "oklch(0.496 0.265 301.924)",
            "primary-foreground": "oklch(0.977 0.014 308.299)",
        },
        dark: {
            primary: "oklch(0.438 0.218 303.724)",
            "primary-foreground": "oklch(0.977 0.014 308.299)",
        },
    },
    red: {
        light: {
            primary: "oklch(0.505 0.213 27.518)",
            "primary-foreground": "oklch(0.971 0.013 17.38)",
        },
        dark: {
            primary: "oklch(0.444 0.177 26.899)",
            "primary-foreground": "oklch(0.971 0.013 17.38)",
        },
    },
    rose: {
        light: {
            primary: "oklch(0.514 0.222 16.935)",
            "primary-foreground": "oklch(0.969 0.015 12.422)",
        },
        dark: {
            primary: "oklch(0.455 0.188 13.697)",
            "primary-foreground": "oklch(0.969 0.015 12.422)",
        },
    },
    sky: {
        light: {
            primary: "oklch(0.5 0.134 242.749)",
            "primary-foreground": "oklch(0.977 0.013 236.62)",
        },
        dark: {
            primary: "oklch(0.443 0.11 240.79)",
            "primary-foreground": "oklch(0.977 0.013 236.62)",
        },
    },
    teal: {
        light: {
            primary: "oklch(0.511 0.096 186.391)",
            "primary-foreground": "oklch(0.984 0.014 180.72)",
        },
        dark: {
            primary: "oklch(0.437 0.078 188.216)",
            "primary-foreground": "oklch(0.984 0.014 180.72)",
        },
    },
    violet: {
        light: {
            primary: "oklch(0.491 0.27 292.581)",
            "primary-foreground": "oklch(0.969 0.016 293.756)",
        },
        dark: {
            primary: "oklch(0.432 0.232 292.759)",
            "primary-foreground": "oklch(0.969 0.016 293.756)",
        },
    },
    yellow: {
        light: {
            primary: "oklch(0.852 0.199 91.936)",
            "primary-foreground": "oklch(0.421 0.095 57.708)",
        },
        dark: {
            primary: "oklch(0.795 0.184 86.047)",
            "primary-foreground": "oklch(0.421 0.095 57.708)",
        },
    },
};
const coloredThemeLightColors: Record<string, string> = {
    secondary: "oklch(0.967 0.001 286.375)",
    "secondary-foreground": "oklch(0.21 0.006 285.885)",
};
const coloredThemeDarkColors: Record<string, string> = {
    secondary: "oklch(0.274 0.006 286.033)",
    "secondary-foreground": "oklch(0.985 0 0)",
};
function createAccentTheme(name: AccentColorName, label: string, primary: PrimaryColors): Theme {
    return {
        name,
        label,
        cssVars: {
            light: { ...coloredThemeLightColors, ...primary.light },
            dark: { ...coloredThemeDarkColors, ...primary.dark },
        },
    };
}
const accentThemes: Theme[] = [
    createAccentTheme("amber", "Amber", primaryColors.amber),
    createAccentTheme("blue", "Blue", primaryColors.blue),
    createAccentTheme("cyan", "Cyan", primaryColors.cyan),
    createAccentTheme("emerald", "Emerald", primaryColors.emerald),
    createAccentTheme("fuchsia", "Fuchsia", primaryColors.fuchsia),
    createAccentTheme("green", "Green", primaryColors.green),
    createAccentTheme("indigo", "Indigo", primaryColors.indigo),
    createAccentTheme("lime", "Lime", primaryColors.lime),
    createAccentTheme("orange", "Orange", primaryColors.orange),
    createAccentTheme("pink", "Pink", primaryColors.pink),
    createAccentTheme("purple", "Purple", primaryColors.purple),
    createAccentTheme("red", "Red", primaryColors.red),
    createAccentTheme("rose", "Rose", primaryColors.rose),
    createAccentTheme("sky", "Sky", primaryColors.sky),
    createAccentTheme("teal", "Teal", primaryColors.teal),
    createAccentTheme("violet", "Violet", primaryColors.violet),
    createAccentTheme("yellow", "Yellow", primaryColors.yellow),
];
export function normalizeBaseColorName(baseColorName: unknown): BaseColorName {
    return typeof baseColorName === "string" && BASE_COLOR_NAMES.includes(baseColorName as BaseColorName)
        ? baseColorName as BaseColorName
        : "neutral";
}
const themesByBaseColor = Object.fromEntries(baseColors.map((baseColor) => [
    baseColor.name,
    [
        baseColor,
        ...accentThemes.map((accentTheme) => ({
            ...accentTheme,
            cssVars: {
                light: { ...baseColor.cssVars.light, ...accentTheme.cssVars.light },
                dark: { ...baseColor.cssVars.dark, ...accentTheme.cssVars.dark },
            },
        })),
    ],
])) as Record<BaseColorName, Theme[]>;
export function getThemesForBaseColor(baseColorName: unknown): Theme[] {
    return themesByBaseColor[normalizeBaseColorName(baseColorName)];
}
export function normalizeThemeName(themeName: unknown, baseColorName: unknown): ThemeName {
    const normalizedBaseColor = normalizeBaseColorName(baseColorName);
    const availableThemes = getThemesForBaseColor(normalizedBaseColor);
    return typeof themeName === "string" && availableThemes.some((theme) => theme.name === themeName)
        ? themeName as ThemeName
        : normalizedBaseColor;
}
export const themes = getThemesForBaseColor("neutral");
export function applyTheme(themeName: unknown, baseColorName: unknown = "neutral") {
    const normalizedBaseColor = normalizeBaseColorName(baseColorName);
    const availableThemes = getThemesForBaseColor(normalizedBaseColor);
    const normalizedTheme = normalizeThemeName(themeName, normalizedBaseColor);
    const theme = availableThemes.find((candidate) => candidate.name === normalizedTheme) || availableThemes[0];
    const root = document.documentElement;
    const isDark = root.classList.contains("dark");
    const vars = isDark ? theme.cssVars.dark : theme.cssVars.light;
    Object.entries(vars).forEach(([key, value]) => {
        root.style.setProperty(`--${key}`, value);
    });
}
