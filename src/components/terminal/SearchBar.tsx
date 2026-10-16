import { useEffect, useRef, useState } from "react";
import { CaseSensitive, ChevronDown, ChevronUp, Regex, X } from "lucide-react";
import { getController } from "@/components/terminal/registry";
import { IconButton } from "@/components/ui/Button";
import { TextInput } from "@/components/ui/Fields";
import { useTerminals } from "@/store/terminals";

export function SearchBar({ terminalId }: { terminalId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<{ index: number; count: number } | null>(null);
  const [invalid, setInvalid] = useState(false);
  const setSearchFor = useTerminals((s) => s.setSearchFor);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    const c = getController(terminalId);
    const sub = c?.onSearchResults((r) => setResults({ index: r.resultIndex, count: r.resultCount }));
    return () => {
      sub?.dispose();
      c?.clearSearch();
    };
  }, [terminalId]);

  function run(direction: "next" | "prev", q = query) {
    const c = getController(terminalId);
    if (!c) return;
    c.setSearchOptions({ caseSensitive, regex });
    setInvalid(false);
    try {
      if (!q) {
        c.clearSearch();
        setResults(null);
        return;
      }
      const found = direction === "next" ? c.searchNext(q) : c.searchPrevious(q);
      if (!found) setResults({ index: -1, count: 0 });
    } catch {
      setInvalid(true); // bad regular expression
    }
  }

  function close() {
    setSearchFor(null);
    requestAnimationFrame(() => getController(terminalId)?.focus());
  }

  return (
    <div
      role="search"
      className="fade-in absolute right-3 top-2 z-10 flex items-center gap-1 rounded-md border border-line bg-elevated p-1 shadow-[var(--shadow)]"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          close();
        }
      }}
    >
      <TextInput
        ref={inputRef}
        aria-label="Search terminal output"
        placeholder="Find"
        value={query}
        aria-invalid={invalid}
        className="h-6 w-44 text-xs"
        onChange={(e) => {
          setQuery(e.target.value);
          run("next", e.target.value);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            run(e.shiftKey ? "prev" : "next");
          }
        }}
      />
      <span className="min-w-12 px-1 text-center text-[11px] text-muted" aria-live="polite">
        {invalid ? "Invalid" : results ? (results.count === 0 ? "No results" : `${results.index + 1}/${results.count}`) : ""}
      </span>
      <IconButton
        size="sm"
        label="Match case"
        active={caseSensitive}
        icon={<CaseSensitive size={14} />}
        onClick={() => {
          setCaseSensitive((v) => !v);
          queueMicrotask(() => run("next"));
        }}
      />
      <IconButton
        size="sm"
        label="Use regular expression"
        active={regex}
        icon={<Regex size={14} />}
        onClick={() => {
          setRegex((v) => !v);
          queueMicrotask(() => run("next"));
        }}
      />
      <IconButton size="sm" label="Previous match" icon={<ChevronUp size={14} />} onClick={() => run("prev")} />
      <IconButton size="sm" label="Next match" icon={<ChevronDown size={14} />} onClick={() => run("next")} />
      <IconButton size="sm" label="Close search" icon={<X size={14} />} onClick={close} />
    </div>
  );
}
