"use client";

import {
  Cloud,
  CircleDollarSign,
  Terminal,
  Store,
  Sparkles,
  Building2,
  ShoppingCart,
  Factory,
  Car,
  HeartPulse,
  Clapperboard,
  Truck,
  Shield,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Cloud,
  CircleDollarSign,
  Terminal,
  Store,
  Sparkles,
  Building2,
  ShoppingCart,
  Factory,
  Car,
  HeartPulse,
  Clapperboard,
  Truck,
  Shield,
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
