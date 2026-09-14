import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { ScrollView } from 'react-native'
import { DEFAULTS } from './state'
import type { LargeFileSettings } from './state'

const { Stack, TableRadioGroup, TableRadioRow, TableRowGroup, TableSwitchRow } =
	Design

export function SettingsComponent({ api }: any) {
	const settings: LargeFileSettings = {
		...DEFAULTS,
		...(api.jsonStorage.use() ?? {}),
	}

	const set = (update: Partial<LargeFileSettings>) => {
		void api.jsonStorage.set(update)
	}

	return (
		<Page spacing={16}>
			<ScrollView>
				<Stack spacing={20} style={{ paddingBottom: 32 }}>
					<TableRowGroup title="Large File Sender">
						<TableSwitchRow
							label="Ativar divisão automática"
							subLabel="Arquivos acima do tamanho escolhido viram partes menores antes do upload."
							value={settings.enabled}
							onValueChange={enabled => set({ enabled })}
						/>
						<TableSwitchRow
							label="Carregar próximos lotes"
							subLabel="Se houver mais de 10 partes, carrega o próximo lote depois que o atual for enviado."
							value={settings.autoQueueBatches}
							onValueChange={autoQueueBatches => set({ autoQueueBatches })}
						/>
					</TableRowGroup>

					<TableRadioGroup
						title="Tamanho de cada parte"
						defaultValue={String(settings.partSizeMiB)}
						onChange={value =>
							set({ partSizeMiB: Number(value) === 9 ? 9 : 19 })
						}
					>
						<TableRadioRow
							label="19 MiB"
							subLabel="Recomendado para limite de 20 MB."
							value="19"
						/>
						<TableRadioRow
							label="9 MiB"
							subLabel="Use se sua conta ou servidor aceitar apenas cerca de 10 MB."
							value="9"
						/>
					</TableRadioGroup>
				</Stack>
			</ScrollView>
		</Page>
	)
}
