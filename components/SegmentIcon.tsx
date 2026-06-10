"use client";

import {
  Cloud,
  CircleDollarSign,
  Terminal,
  Store,
  Sparkles,
  Building2,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Cloud,
  CircleDollarSign,
  Terminal,
  Store,
  Sparkles,
  Building2,
};

export function SegmentIcon({
  name,
  className,
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICONS[name] ?? Building2;
  return <Icon className={className} />;
}
