import { memberName, type SessionView } from '@zirzircord/client-core';
import { type FormatNode, parseFormat, splitMentions } from '@zirzircord/shared';
import { type ReactNode, useMemo, useState } from 'react';
import { Linking, Platform, ScrollView, Text, View } from 'react-native';
import { C, s } from '../theme';

const MONO = Platform.select({ ios: 'Menlo', default: 'monospace' });

/** Hidden until tapped. */
function Spoiler({ children }: { children: ReactNode }) {
  const [shown, setShown] = useState(false);
  return (
    <Text
      onPress={() => setShown(true)}
      accessibilityLabel={shown ? undefined : 'Spoiler, tap to reveal'}
      style={shown ? { backgroundColor: C.field } : { backgroundColor: C.faint, color: 'transparent' }}
    >
      {children}
    </Text>
  );
}

const isBlock = (n: FormatNode) => n.type === 'quote' || n.type === 'codeblock';

/**
 * Message text: markdown-style formatting (packages/shared/src/format.ts), tappable links and
 * @mention pills. Inline styles are nested <Text>; quotes and code blocks are separate Views.
 */
export function FormattedText({ text, view, trailing }: { text: string; view: SessionView | undefined; trailing?: ReactNode }) {
  const nodes = useMemo(() => parseFormat(text), [text]);

  const inline = (list: FormatNode[]): ReactNode[] =>
    list.map((n, i) => {
      switch (n.type) {
        case 'text':
          return splitMentions(n.text).map((part, j) =>
            part.type === 'text' ? (
              part.text
            ) : (
              <Text key={`${i}-${j}`} style={{ color: C.brand, fontWeight: '700', backgroundColor: C.brand + '26' }}>
                @{part.type === 'everyone' ? 'everyone' : memberName(view, part.userId)}
              </Text>
            ),
          );
        case 'url':
          return (
            <Text key={i} style={{ color: '#38bdf8', textDecorationLine: 'underline' }} onPress={() => Linking.openURL(n.url).catch(() => {})}>
              {n.url}
            </Text>
          );
        case 'bold':
          return (
            <Text key={i} style={{ fontWeight: '700' }}>
              {inline(n.children)}
            </Text>
          );
        case 'italic':
          return (
            <Text key={i} style={{ fontStyle: 'italic' }}>
              {inline(n.children)}
            </Text>
          );
        case 'underline':
          return (
            <Text key={i} style={{ textDecorationLine: 'underline' }}>
              {inline(n.children)}
            </Text>
          );
        case 'strike':
          return (
            <Text key={i} style={{ textDecorationLine: 'line-through' }}>
              {inline(n.children)}
            </Text>
          );
        case 'spoiler':
          return <Spoiler key={i}>{inline(n.children)}</Spoiler>;
        case 'code':
          return (
            <Text key={i} style={{ fontFamily: MONO, fontSize: 13, backgroundColor: C.field }}>
              {` ${n.text} `}
            </Text>
          );
        default:
          return null; // blocks are handled below
      }
    });

  // Consecutive inline nodes share one <Text>; blocks sit between them as Views.
  const groups: Array<{ block: false; nodes: FormatNode[] } | { block: true; node: FormatNode }> = [];
  for (const n of nodes) {
    if (isBlock(n)) groups.push({ block: true, node: n });
    else if (groups.length && !groups[groups.length - 1].block) (groups[groups.length - 1] as { nodes: FormatNode[] }).nodes.push(n);
    else groups.push({ block: false, nodes: [n] });
  }
  // The "(edited)" marker goes at the end of the last text run, or on its own line after a block.
  if (trailing && (!groups.length || groups[groups.length - 1].block)) groups.push({ block: false, nodes: [] });

  return (
    <View style={{ gap: 4 }}>
      {groups.map((g, i) => {
        if (!g.block) {
          const isLast = i === groups.length - 1;
          return (
            <Text key={i} style={[s.text, { lineHeight: 21 }]} selectable>
              {inline(g.nodes)}
              {isLast ? trailing : null}
            </Text>
          );
        }
        if (g.node.type === 'codeblock') {
          return (
            <ScrollView key={i} horizontal style={{ backgroundColor: C.elev, borderRadius: 8 }} contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 8 }}>
              <Text selectable style={{ fontFamily: MONO, fontSize: 13, color: C.fg }}>
                {g.node.text}
              </Text>
            </ScrollView>
          );
        }
        if (g.node.type === 'quote') {
          return (
            <View key={i} style={{ borderLeftWidth: 3, borderLeftColor: C.line, paddingLeft: 10 }}>
              <Text style={[s.text, { lineHeight: 21, color: C.muted }]} selectable>
                {inline(g.node.children)}
              </Text>
            </View>
          );
        }
        return null;
      })}
    </View>
  );
}
