"use client";

import { useMemo } from "react";
import { Star } from "lucide-react";
import type { Signal, CompanyIntel as Intel } from "@/lib/types";
import { useFavorites, companyInMap } from "@/lib/clientStore";
import { SignalCard } from "./SignalCard";
import { IntelExpander } from "./IntelExpander";

// The "Signal favorites" tab — the rep's starred companies, pulled from the
// loaded cache. Cards behave exactly like the feed (brief expands inline).
export function FavoritesView({
  signals,
  onSelectCompany,
  onGetIntel,
  expandedCompany,
  intel,
  intelLoading,
  intelError,
  onCloseIntel,
  onRefreshIntel,
}: {
  signals: Signal[];
  onSelectCompany: (c: string) => void;
  onGetIntel: (c: string) => void;
  expandedCompany: string | null;
  intel: Intel | null;
  intelLoading: boolean;
  intelError: string | null;
  onCloseIntel: () => void;
  onRefreshIntel: (c: string) => void;
}) {
  const favs = useFavorites();
  const favSignals = useMemo(
    () => signals.filter((s) => companyInMap(favs, s.account)),
    [signals, favs],
  );

  const toggleCompany = (account: string) =>
    account === expandedCompany ? onCloseIntel() : onSelectCompany(account);

  const expandAfterIdx = expandedCompany
    ? favSignals.findIndex((s) => s.account === expandedCompany)
    : -1;
  const expanderEl = expandedCompany ? (
    <IntelExpander
      key={expandedCompany}
      company={expandedCompany}
      intel={intel}
      loading={intelLoading}
      error={intelError}
      onClose={onCloseIntel}
      onRetry={() => onGetIntel(expandedCompany)}
      onRefresh={() => onRefreshIntel(expandedCompany)}
    />
  ) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="flex items-center gap-2 text-xl font-bold text-ink-50">
          <Star className="h-5 w-5 fill-amber-400 text-amber-400" /> Signal Favorites
        </h2>
        <p className="mt-1 text-sm text-ink-300">
          Companies you&apos;ve starred for quick access.
        </p>
      </div>

      {/* A starred company whose card isn't in the list still expands here. */}
      {expandedCompany && expandAfterIdx === -1 && expanderEl}

      {favSignals.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink-700 bg-ink-900/50 p-12 text-center">
          <p className="text-sm text-ink-400">
            No favorites yet. Tap the star on a signal card to add it here.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {favSignals.map((s, i) => (
            <div key={s.id}>
              <SignalCard
                signal={s}
                index={i}
                onSelect={toggleCompany}
                expanded={s.account === expandedCompany}
              />
              {i === expandAfterIdx && expanderEl}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
