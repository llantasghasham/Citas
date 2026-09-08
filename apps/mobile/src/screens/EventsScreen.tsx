import { FlatList, Pressable, Text, View } from 'react-native';

import type { Dictionary } from '@citas/core';

import type { EventSummary, Me } from '../api';
import { theme } from '../theme';

interface EventsScreenProps {
  dictionary: Dictionary;
  me: Me;
  events: EventSummary[];
  onOpen: (event: EventSummary) => void;
}

/**
 * The organiser's home: every event with its replies. The same numbers the web
 * panel shows, from the same endpoint — people counted, not answers.
 */
export function EventsScreen({ dictionary, me, events, onOpen }: EventsScreenProps) {
  const copy = dictionary.admin.events;

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: theme.rule }}>
        <Text style={{ fontSize: 24, color: theme.ink }}>{copy.heading}</Text>
        <Text style={{ color: theme.muted }}>{me.tenant?.name ?? me.email}</Text>
      </View>

      <FlatList
        data={events}
        keyExtractor={(event) => event.id}
        ListEmptyComponent={
          <Text style={{ padding: 20, color: theme.muted }}>{copy.empty}</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            onPress={() => onOpen(item)}
            style={{
              paddingHorizontal: 20,
              paddingVertical: 16,
              borderBottomWidth: 1,
              borderBottomColor: theme.rule,
              gap: 6,
            }}
          >
            <Text style={{ fontSize: 17, color: theme.ink }}>{item.title}</Text>
            <Text style={{ color: theme.muted }}>
              {item.date} · {dictionary.eventTypes[item.type as keyof typeof dictionary.eventTypes]}
            </Text>
            <Text style={{ color: theme.gold }}>
              {copy.attending}: {item.attending} · {copy.tentative}: {item.tentative} ·{' '}
              {copy.declined}: {item.declined}
            </Text>
          </Pressable>
        )}
      />
    </View>
  );
}
