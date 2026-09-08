import { FlatList, Pressable, Text, View } from 'react-native';

import type { Dictionary } from '@citas/core';

import type { EventSummary, Guest } from '../api';
import { theme } from '../theme';

interface GuestsScreenProps {
  dictionary: Dictionary;
  event: EventSummary;
  guests: Guest[];
  onBack: () => void;
}

/** One event's replies, as they come in. */
export function GuestsScreen({ dictionary, event, guests, onBack }: GuestsScreenProps) {
  const copy = dictionary.admin.events;
  const replies = dictionary.rsvpForm;

  const label = (status: string | null): string => {
    if (status === 'attending') return replies.attending;
    if (status === 'declined') return replies.declined;
    if (status === 'tentative') return replies.tentative;
    return '—';
  };

  return (
    <View style={{ flex: 1 }}>
      <View style={{ padding: 20, borderBottomWidth: 1, borderBottomColor: theme.rule, gap: 6 }}>
        <Pressable onPress={onBack}>
          <Text style={{ color: theme.gold }}>{dictionary.create.back}</Text>
        </Pressable>
        <Text style={{ fontSize: 22, color: theme.ink }}>{event.title}</Text>
        <Text style={{ color: theme.muted }}>
          {copy.guests}: {guests.length}
        </Text>
      </View>

      <FlatList
        data={guests}
        keyExtractor={(guest, index) => `${guest.name}-${index}`}
        ListEmptyComponent={<Text style={{ padding: 20, color: theme.muted }}>{copy.empty}</Text>}
        renderItem={({ item }) => (
          <View
            style={{
              paddingHorizontal: 20,
              paddingVertical: 14,
              borderBottomWidth: 1,
              borderBottomColor: theme.rule,
              gap: 4,
            }}
          >
            <Text style={{ fontSize: 16, color: theme.ink }}>{item.name}</Text>
            <Text style={{ color: theme.muted }}>
              {label(item.status)}
              {item.party === null ? '' : ` · ${item.party}`}
            </Text>
            {item.message === null ? null : (
              <Text style={{ color: theme.muted, fontStyle: 'italic' }}>{item.message}</Text>
            )}
          </View>
        )}
      />
    </View>
  );
}
