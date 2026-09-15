import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { ScrollView } from 'react-native'
import { DEFAULTS } from './state'
import type { LargeVideoSettings } from './state'

const { Stack, TableRadioGroup, TableRadioRow, TableRowGroup, TableSwitchRow } =
	Design

export function SettingsComponent({ api }: any) {
	const settings: LargeVideoSettings = {
		...DEFAULTS,
		...(api.jsonStorage.use() ?? {}),
	}

	const set = (update: Partial<LargeVideoSettings>) => {
		void api.jsonStorage.set(update)
	}

	return (
		<Page spacing={16}>
			<ScrollView>
				<Stack spacing={20} style={{ paddingBottom: 32 }}>
					<TableRowGroup title="Large Video Sender">
						<TableSwitchRow
							label="Comprimir vídeos grandes"
							subLabel="Força o encoder do próprio Discord a reduzir vídeos que ultrapassariam o limite de upload."
							value={settings.enabled}
							onValueChange={enabled => set({ enabled })}
						/>
					</TableRowGroup>

					<TableRadioGroup
						title="Tamanho alvo"
						defaultValue={String(settings.targetSizeMB)}
						onChange={value =>
							set({ targetSizeMB: Number(value) === 9 ? 9 : 19 })
						}
					>
						<TableRadioRow
							label="19 MB"
							subLabel="Recomendado para contas com limite de 20 MB."
							value="19"
						/>
						<TableRadioRow
							label="9 MB"
							subLabel="Use se o seu limite efetivo for 10 MB."
							value="9"
						/>
					</TableRadioGroup>
				</Stack>
			</ScrollView>
		</Page>
	)
}
