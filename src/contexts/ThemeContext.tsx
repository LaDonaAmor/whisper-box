import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark" | "system";
const KEY = "wb.theme";

interface Ctx {
  theme: Theme;
  resolved: "light" | "dark";
  setTheme: (t: Theme) => void;
}

const ThemeContext = createContext<Ctx | null>(null);

function apply(theme: Theme): "light" | "dark" {
  const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const resolved: "light" | "dark" =
    theme === "system" ? (sysDark ? "dark" : "light") : theme;
  const root = document.documentElement;
  root.classList.toggle("dark", resolved === "dark");
  root.style.colorScheme = resolved;
  return resolved;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    return (localStorage.getItem(KEY) as Theme | null) ?? "system";
  });
  const [resolved, setResolved] = useState<"light" | "dark">(() =>
    apply((localStorage.getItem(KEY) as Theme | null) ?? "system"),
  );

  useEffect(() => {
    setResolved(apply(theme));
    localStorage.setItem(KEY, theme);
  }, [theme]);

  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setResolved(apply("system"));
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  return (
    <ThemeContext.Provider value={{ theme, resolved, setTheme: setThemeState }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside ThemeProvider");
  return ctx;
}
