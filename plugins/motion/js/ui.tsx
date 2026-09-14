import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { ScrollView } from 'react-native'
import { DEFAULTS, type MotionPreset, type MotionSettings } from './state'

const { Stack, TableRadioGroup, TableRadioRow, TableRowGroup, TableSwitchRow } =
  Design

export function SettingsComponent({ api }: any) {
  const settings: MotionSettings = {
    ...DEFAULTS,
    ...(api.jsonStorage.use() ?? {}),
  }

  const set = (update: Partial<MotionSettings>) => {
    void api.jsonStorage.set(update)
  }

  return (
    <Page spacing={16}>
      <ScrollView>
        <Stack spacing={20} style={{ paddingBottom: 32 }}>
          <TableRowGroup title="Motion">
            <TableSwitchRow
              label="Ativar animações"
              subLabel="Liga ou desliga todos os efeitos do plugin."
              value={settings.enabled}
              onValueChange={enabled => set({ enabled })}
            />
            <TableSwitchRow
              label="Respeitar Reduzir animações"
              subLabel="Desativa os efeitos quando o Android pedir menos movimento."
              value={settings.respectReduceMotion}
              onValueChange={respectReduceMotion =>
                set({ respectReduceMotion })
              }
            />
          </TableRowGroup>

          <TableRadioGroup
            title="Estilo"
            defaultValue={settings.preset}
            onChange={value => set({ preset: value as MotionPreset })}
          >
            <TableRadioRow
              label="Suave"
              subLabel="Rápido e discreto."
              value="subtle"
            />
            <TableRadioRow
              label="Fluido"
              subLabel="Equilíbrio entre velocidade e movimento."
              value="smooth"
            />
            <TableRadioRow
              label="Elástico"
              subLabel="Mais vivo, com efeito de mola."
              value="bouncy"
            />
          </TableRadioGroup>

          <TableRowGroup title="Onde animar">
            <TableSwitchRow
              label="Navegação"
              subLabel="Telas, voltar e mudanças de rota."
              value={settings.navigation}
              onValueChange={navigation => set({ navigation })}
            />
            <TableSwitchRow
              label="Servidores e canais"
              subLabel="Trocas de servidor, canal e conversas."
              value={settings.channels}
              onValueChange={channels => set({ channels })}
            />
            <TableSwitchRow
              label="Menus e modais"
              subLabel="Action sheets, alertas e fechamento de camadas."
              value={settings.sheets}
              onValueChange={sheets => set({ sheets })}
            />
            <TableSwitchRow
              label="Botões"
              subLabel="Adiciona resposta de pressão aos controles do Discord."
              value={settings.controls}
              onValueChange={controls => set({ controls })}
            />
          </TableRowGroup>
        </Stack>
      </ScrollView>
    </Page>
  )
}
