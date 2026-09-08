import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, I18nManager, Pressable, SafeAreaView, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';

import { getDictionary, LOCALES, type Locale } from '@citas/core';

import { fetchEvents, fetchGuests, fetchMe, type EventSummary, type Guest, type Me } from './src/api';
import { SignInScreen } from './src/screens/SignInScreen';
import { EventsScreen } from './src/screens/EventsScreen';
import { GuestsScreen } from './src/screens/GuestsScreen';
import { clearToken, readToken, writeToken } from './src/storage';
import { theme } from './src/theme';

// Right-to-left has to be permitted before the first render.
I18nManager.allowRTL(true);

function asLocale(value: string | undefined): Locale {
  return LOCALES.find((candidate) => candidate === value) ?? 'ar';
}

/**
 * One app for the whole staff: an organiser sees their own event, an office
 * admin sees the office's portfolio. What changes is what the role allows, not
 * which app was installed.
 */
export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [events, setEvents] = useState<EventSummary[]>([]);
  const [openEvent, setOpenEvent] = useState<EventSummary | null>(null);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [needsRestart, setNeedsRestart] = useState(false);

  const locale = asLocale(me?.tenant?.locale);
  const dictionary = getDictionary(locale);

  useEffect(() => {
    void readToken().then((stored) => {
      setToken(stored);
      if (stored === null) setLoading(false);
    });
  }, []);

  const load = useCallback(async (activeToken: string) => {
    setLoading(true);
    try {
      const [profile, list] = await Promise.all([
        fetchMe(activeToken),
        fetchEvents(activeToken).catch(() => ({ events: [] })),
      ]);
      setMe(profile);
      setEvents(list.events);
    } catch {
      // A token the server no longer accepts is not a token.
      await clearToken();
      setToken(null);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (token !== null) void load(token);
  }, [token, load]);

  useEffect(() => {
    if (me === null) return;
    const shouldBeRtl = locale === 'ar';
    // Flipping direction only takes effect on the next launch: React Native
    // decides its layout direction at start-up, so the app has to say so
    // instead of half-flipping.
    if (shouldBeRtl !== I18nManager.isRTL) {
      I18nManager.forceRTL(shouldBeRtl);
      setNeedsRestart(true);
    }
  }, [me, locale]);

  async function signIn(newToken: string): Promise<void> {
    await writeToken(newToken);
    setToken(newToken);
  }

  async function signOut(): Promise<void> {
    await clearToken();
    setToken(null);
    setMe(null);
    setEvents([]);
    setOpenEvent(null);
  }

  async function openGuests(event: EventSummary): Promise<void> {
    if (token === null) return;
    setOpenEvent(event);
    setGuests([]);
    const { guests: list } = await fetchGuests(token, event.id).catch(() => ({ guests: [] }));
    setGuests(list);
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
      <StatusBar style="dark" />

      {needsRestart ? (
        <Text style={{ padding: 12, backgroundColor: theme.gold, color: theme.background }}>
          {dictionary.admin.panel.restartNeeded}
        </Text>
      ) : null}

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator color={theme.gold} />
        </View>
      ) : token === null || me === null ? (
        <SignInScreen dictionary={dictionary} onSignedIn={(value) => void signIn(value)} />
      ) : openEvent === null ? (
        <View style={{ flex: 1 }}>
          <EventsScreen
            dictionary={dictionary}
            me={me}
            events={events}
            onOpen={(event) => void openGuests(event)}
          />
          <Pressable onPress={() => void signOut()} style={{ padding: 16 }}>
            <Text style={{ color: theme.muted, textAlign: 'center' }}>
              {dictionary.admin.panel.signOut}
            </Text>
          </Pressable>
        </View>
      ) : (
        <GuestsScreen
          dictionary={dictionary}
          event={openEvent}
          guests={guests}
          onBack={() => setOpenEvent(null)}
        />
      )}
    </SafeAreaView>
  );
}
