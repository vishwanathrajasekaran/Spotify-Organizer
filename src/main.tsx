import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

function ThemeToggle() {
  const [theme, setTheme] = useState<"light" | "dark">(() =>
    (localStorage.getItem("vr-theme") as "light" | "dark" | null) ?? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
  useEffect(() => { document.documentElement.dataset.theme = theme; localStorage.setItem("vr-theme", theme); }, [theme]);
  return <button className="theme clay" aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀" : "☾"}</button>;
}
createRoot(document.getElementById("root")!).render(<><ThemeToggle /><App /></>);
