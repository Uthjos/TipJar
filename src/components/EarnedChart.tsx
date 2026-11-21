/**
 * Bar chart of what the user earned in each bucket of a History period (M7).
 * react-native-gifted-charts draws the bars; screen readers get one text description of every
 * bar (the SVG bars themselves aren't accessible).
 */
import { useState } from 'react';
import { Text, View } from 'react-native';
import { BarChart } from 'react-native-gifted-charts';

import { formatCents } from '@/engine/money';
import type { Cents } from '@/engine/types';
import { font, spacing, useColors } from '@/theme';

function shortDollars(c: Cents): string {
  const d = c / 100;
  return d >= 1000 ? `$${(d / 1000).toFixed(1).replace(/\.0$/, '')}k` : `$${Math.round(d)}`;
}

export function EarnedChart({
  series,
  description,
}: {
  series: { key: string; label: string; earned: Cents }[];
  /** What the bars are, for screen readers, e.g. "Earned per day, week of Nov 15 – 21, 2026". */
  description: string;
}) {
  const c = useColors();
  const [width, setWidth] = useState(0);
  const many = series.length > 12; // month view: one bar per day
  const plotWidth = Math.max(0, width - 40);
  const slot = series.length > 0 ? plotWidth / series.length : 0;
  const barWidth = Math.max(4, Math.min(28, slot * 0.6));
  const gap = Math.max(1, slot - barWidth);

  const data = series.map((b, i) => ({
    value: b.earned / 100,
    // Month view: label every 5th day so the axis stays readable.
    label: !many || i === 0 || (i + 1) % 5 === 0 ? b.label : '',
    frontColor: c.primary,
    topLabelComponent:
      b.earned > 0 && !many
        ? () => (
            <Text style={{ color: c.textMuted, fontSize: 10, marginBottom: 2 }}>
              {shortDollars(b.earned)}
            </Text>
          )
        : undefined,
  }));

  const spoken = series
    .map((b) => `${b.label} ${b.earned > 0 ? formatCents(b.earned) : 'nothing'}`)
    .join(', ');

  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`${description}. ${spoken}.`}
      onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
      style={{ minHeight: 200, paddingTop: spacing.sm }}
    >
      {width > 0 ? (
        <BarChart
          data={data}
          width={plotWidth}
          height={160}
          barWidth={barWidth}
          spacing={gap}
          initialSpacing={gap / 2}
          noOfSections={3}
          yAxisLabelPrefix="$"
          yAxisThickness={0}
          xAxisColor={c.border}
          rulesColor={c.border}
          yAxisTextStyle={{ color: c.textMuted, fontSize: font.small - 2 }}
          xAxisLabelTextStyle={{ color: c.textMuted, fontSize: font.small - 2 }}
          labelWidth={many ? 24 : Math.max(24, slot)}
          disableScroll
          isAnimated={false}
        />
      ) : null}
    </View>
  );
}
