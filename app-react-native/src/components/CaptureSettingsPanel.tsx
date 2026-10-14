import { useState } from 'react';
import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import {
  BITRATE_OPTIONS,
  CAPTURE_SOURCE_OPTIONS,
  FPS_OPTIONS,
  formatCaptureSettings,
  RESOLUTION_OPTIONS,
  type CaptureSettings,
} from '@/domain/capture';
import { colors, radius, spacing } from '@/theme/tokens';

type Choice<T extends string | number | null> = { value: T; label: string };

function ChoiceRow<T extends string | number | null>({ label, value, options, onChange }: {
  label: string;
  value: T;
  options: readonly Choice<T>[];
  onChange: (next: T) => void;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.choices}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable key={String(option.value)} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => onChange(option.value)} style={[styles.choice, selected && styles.choiceSelected]}>
              <Text style={[styles.choiceText, selected && styles.choiceTextSelected]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

function ToggleRow({ title, detail, value, onPress }: { title: string; detail: string; value: boolean; onPress: () => void }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityState={{ checked: value }} onPress={onPress} style={styles.toggleRow}>
      <View style={styles.toggleCopy}>
        <Text style={styles.toggleTitle}>{title}</Text>
        <Text style={styles.toggleDetail}>{detail}</Text>
      </View>
      <View style={[styles.toggleTrack, value && styles.toggleTrackOn]}>
        <View style={[styles.toggleKnob, value && styles.toggleKnobOn]} />
      </View>
    </Pressable>
  );
}

export function CaptureSettingsPanel({ settings, screenAudioAvailable, onChange }: {
  settings: CaptureSettings;
  screenAudioAvailable: boolean;
  onChange: (settings: CaptureSettings) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const update = (patch: Partial<CaptureSettings>) => onChange({ ...settings, ...patch });
  const usesScreen = settings.source !== 'camera';
  const usesCamera = settings.source !== 'screen';

  return (
    <View style={styles.wrap}>
      <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded((current) => !current)} style={styles.summary}>
        <View style={styles.settingsIcon}><Text style={styles.gear}>⚙</Text></View>
        <View style={styles.summaryCopy}>
          <Text style={styles.summaryTitle}>Configurações</Text>
          <Text numberOfLines={1} style={styles.summaryDetail}>{formatCaptureSettings(settings)}</Text>
        </View>
        <Text style={styles.chevron}>{expanded ? '⌃' : '⌄'}</Text>
      </Pressable>

      {expanded ? (
        <View style={styles.panel}>
          <View style={styles.panelHeading}>
            <View>
              <Text style={styles.panelTitle}>Configurações da transmissão</Text>
              <Text style={styles.panelSubtitle}>Aplicadas quando você iniciar</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel="Fechar configurações" onPress={() => setExpanded(false)} hitSlop={10}>
              <Text style={styles.close}>×</Text>
            </Pressable>
          </View>

          <ChoiceRow
            label="Fonte da transmissão"
            value={settings.source}
            options={CAPTURE_SOURCE_OPTIONS}
            onChange={(source) => update({ source })}
          />
          <ChoiceRow
            label="Resolução"
            value={settings.resolution}
            options={RESOLUTION_OPTIONS.map(({ value, label }) => ({ value, label }))}
            onChange={(resolution) => update({ resolution })}
          />
          <ChoiceRow
            label="Quadros por segundo"
            value={settings.fps}
            options={FPS_OPTIONS.map((fps) => ({ value: fps, label: `${fps} FPS` }))}
            onChange={(fps) => update({ fps })}
          />
          <ChoiceRow
            label="Bitrate máximo"
            value={settings.bitrate}
            options={BITRATE_OPTIONS}
            onChange={(bitrate) => update({ bitrate })}
          />

          {usesScreen ? (
            <View style={[styles.capability, screenAudioAvailable && styles.capabilityAvailable]}>
              <View style={styles.capabilityDot} />
              <View style={styles.capabilityCopy}>
                <Text style={styles.capabilityTitle}>Áudio da tela</Text>
                <Text style={styles.capabilityDetail}>{screenAudioAvailable ? 'Disponível nesta captura' : Platform.OS === 'web' ? 'Depende do navegador e da tela escolhida' : 'Indisponível nesta versão do capturador Android'}</Text>
              </View>
              <Text style={styles.capabilityState}>{screenAudioAvailable ? 'DISPONÍVEL' : Platform.OS === 'web' ? 'VARIÁVEL' : 'INDISPONÍVEL'}</Text>
            </View>
          ) : null}

          {usesCamera ? (
            <>
              <ToggleRow title="Microfone" detail="Áudio enviado junto à câmera" value={settings.microphone} onPress={() => update({ microphone: !settings.microphone })} />
              <ChoiceRow
                label="Câmera"
                value={settings.cameraFacing}
                options={[{ value: 'user', label: 'Frontal' }, { value: 'environment', label: 'Traseira' }]}
                onChange={(cameraFacing) => update({ cameraFacing })}
              />
            </>
          ) : null}

          <Text style={styles.help}>O bitrate é o limite por espectador. Valores maiores usam mais upload.</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 8 },
  summary: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, backgroundColor: '#0e1d3194' },
  settingsIcon: { width: 29, height: 29, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#75e5e03d', borderRadius: radius.sm, backgroundColor: '#75e5e00d' },
  gear: { color: colors.cyan, fontSize: 17 },
  summaryCopy: { flex: 1, gap: 3 },
  summaryTitle: { color: colors.text, fontSize: 11, fontWeight: '800' },
  summaryDetail: { color: '#7893ad', fontSize: 9 },
  chevron: { color: colors.cyan, fontSize: 19, lineHeight: 22 },
  panel: { gap: 15, padding: 14, borderWidth: 1, borderColor: '#75e5e03d', borderRadius: radius.md, backgroundColor: colors.panelRaised },
  panelHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  panelTitle: { color: colors.text, fontSize: 12, fontWeight: '800' },
  panelSubtitle: { marginTop: 3, color: colors.muted, fontSize: 10 },
  close: { width: 27, height: 27, overflow: 'hidden', borderWidth: 1, borderColor: colors.border, borderRadius: 7, color: colors.mutedBright, fontSize: 21, lineHeight: 24, textAlign: 'center' },
  field: { gap: 7 },
  fieldLabel: { color: '#87a1ba', fontSize: 9, fontWeight: '800', letterSpacing: 0.8, textTransform: 'uppercase' },
  choices: { gap: 7, paddingRight: 4 },
  choice: { minHeight: 33, justifyContent: 'center', paddingHorizontal: 11, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: '#ffffff05' },
  choiceSelected: { borderColor: '#75e5e080', backgroundColor: '#75e5e018' },
  choiceText: { color: colors.mutedBright, fontSize: 10, fontWeight: '700' },
  choiceTextSelected: { color: colors.cyan },
  capability: { minHeight: 54, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: '#ffffff04' },
  capabilityAvailable: { borderColor: '#9ff1af38', backgroundColor: '#9ff1af0d' },
  capabilityDot: { width: 6, height: 6, borderRadius: radius.pill, backgroundColor: colors.muted },
  capabilityCopy: { flex: 1, gap: 3 },
  capabilityTitle: { color: colors.text, fontSize: 10, fontWeight: '800' },
  capabilityDetail: { color: colors.muted, fontSize: 9 },
  capabilityState: { color: colors.muted, fontSize: 7, fontWeight: '900', letterSpacing: 0.45 },
  toggleRow: { minHeight: 54, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingHorizontal: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radius.sm, backgroundColor: '#ffffff04' },
  toggleCopy: { gap: 3 },
  toggleTitle: { color: colors.text, fontSize: 10, fontWeight: '800' },
  toggleDetail: { color: colors.muted, fontSize: 9 },
  toggleTrack: { width: 38, height: 22, justifyContent: 'center', padding: 3, borderRadius: radius.pill, backgroundColor: '#3c5269' },
  toggleTrackOn: { alignItems: 'flex-end', backgroundColor: colors.cyan },
  toggleKnob: { width: 16, height: 16, borderRadius: radius.pill, backgroundColor: '#e6f2ff' },
  toggleKnobOn: { backgroundColor: colors.onAccent },
  help: { marginTop: -2, color: '#7893ad', fontSize: 9, lineHeight: 14 },
});
