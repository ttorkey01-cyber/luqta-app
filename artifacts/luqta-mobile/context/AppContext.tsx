import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Haptics from 'expo-haptics';
import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { CreateHuntInput, Hunt, huntService } from '@/services/huntService';

const FAVORITES_KEY = '@luqta/favorites';

type AppContextValue = {
  favorites: string[];
  hunts: Hunt[];
  hydrated: boolean;
  isFavorite: (id: string) => boolean;
  toggleFavorite: (id: string) => void;
  createHunt: (input: CreateHuntInput) => Promise<Hunt>;
  updateHunt: (id: string, updates: Partial<Hunt>) => Promise<void>;
  deleteHunt: (id: string) => Promise<void>;
};

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [favorites, setFavorites] = useState<string[]>([]);
  const [hunts, setHunts] = useState<Hunt[]>([]);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    Promise.all([AsyncStorage.getItem(FAVORITES_KEY), huntService.list()])
      .then(([storedFavorites, storedHunts]) => {
        if (storedFavorites) {
          setFavorites(JSON.parse(storedFavorites) as string[]);
        }
        setHunts(storedHunts);
      })
      .catch(() => undefined)
      .finally(() => setHydrated(true));
  }, []);

  const toggleFavorite = (id: string) => {
    setFavorites((current) => {
      const next = current.includes(id)
        ? current.filter((favoriteId) => favoriteId !== id)
        : [...current, id];
      void AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(next));
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      return next;
    });
  };

  const createHunt = async (input: CreateHuntInput) => {
    const created = await huntService.create(input);
    setHunts((current) => [created, ...current]);
    return created;
  };

  const updateHunt = async (id: string, updates: Partial<Hunt>) => {
    const updated = await huntService.update(id, updates);
    setHunts(current => current.map(h => h.id === id ? updated : h));
  };

  const deleteHunt = async (id: string) => {
    await huntService.remove(id);
    setHunts(current => current.filter(h => h.id !== id));
  };

  const value = useMemo(
    () => ({
      favorites,
      hunts,
      hydrated,
      isFavorite: (id: string) => favorites.includes(id),
      toggleFavorite,
      createHunt,
      updateHunt,
      deleteHunt,
    }),
    [favorites, hunts, hydrated]
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used inside AppProvider');
  }
  return context;
}
