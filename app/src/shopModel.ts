// What the Garage and Shop screens show: the server's prices and ownership joined to how each item looks.

import { useState } from "react";
import { api, useAppState, useFetch, type Driver, type ShopItem, type ShopState } from "./api";
import { DECALS, RARITY_COLOR, SHELLS, STRIPES, type Look, type Rarity } from "./looks";

export type Slot = ShopItem["slot"];

export const SLOTS: { slot: Slot; label: string; title: string }[] = [
  { slot: "shell", label: "Shells", title: "Shell" },
  { slot: "decal", label: "Decals", title: "Decal" },
  { slot: "stripe", label: "Stripes", title: "Stripe" },
];

export interface Offer {
  slot: Slot;
  id: string;
  name: string;
  rarity: Rarity;
  rarityColor: string;
  price: number;
  minLevel: number;
  /** Everyone has it: free, or bought. */
  owned: boolean;
  /** Free items are never sold, they are just there. */
  free: boolean;
  locked: boolean;
  affordable: boolean;
  /** The helmet shown on its tile: this item and nothing else. */
  preview: Look;
}

const NAMES: Record<Slot, { id: string; name: string; rarity: Rarity }[]> = { shell: SHELLS, decal: DECALS, stripe: STRIPES };

export const ownedKey = (slot: Slot, id: string) => `${slot}:${id}`;

/** Every item the server sells, with how to show it. Items the app has no drawing for are left out. */
export function offers(shop: ShopState): Offer[] {
  return shop.items.flatMap((it) => {
    const meta = NAMES[it.slot].find((m) => m.id === it.id);
    if (!meta) return [];
    const free = it.price === 0;
    const owned = free || shop.owned.includes(ownedKey(it.slot, it.id));
    return [
      {
        slot: it.slot,
        id: it.id,
        name: meta.name,
        rarity: meta.rarity,
        rarityColor: RARITY_COLOR[meta.rarity],
        price: it.price,
        minLevel: it.minLevel,
        owned,
        free,
        locked: !owned && shop.level < it.minLevel,
        affordable: owned || shop.coins >= it.price,
        preview: it.slot === "shell" ? { shell: it.id } : it.slot === "decal" ? { decal: it.id } : { stripe: it.id },
      },
    ];
  });
}

/** The driver the Garage and Shop belong to: this phone's, or on the PC whoever is in the seat. */
export function useShopDriver(): { driver: Driver | null; local: boolean; ready: boolean } {
  const { drivers, status } = useAppState();
  const info = useFetch(() => api.me(), [drivers]);
  const id = info?.driver?.id ?? (info?.local ? (status?.seat ?? null) : null);
  return { driver: drivers.find((d) => d.id === id) ?? null, local: !!info?.local, ready: info != null };
}

/** The shop for a driver. Refetches after any driver change (a purchase from elsewhere) and on `refresh()`. */
export function useShop(driverId: number | null): { shop: ShopState | null; refresh: () => void } {
  const { drivers } = useAppState();
  const [tick, setTick] = useState(0);
  const shop = useFetch<ShopState>(driverId != null ? () => api.shop(driverId) : null, [driverId, drivers, tick]);
  return { shop, refresh: () => setTick((t) => t + 1) };
}
