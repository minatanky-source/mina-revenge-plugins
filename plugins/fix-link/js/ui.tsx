import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { ScrollView } from 'react-native'
import { DEFAULTS } from './state'
import type { FixLinkSettings } from './state'

const { Stack, TableRowGroup, TableSwitchRow } = Design

export function SettingsComponent({ api }: any) {
	const settings: FixLinkSettings = {
		...DEFAULTS,
		...(api.jsonStorage.use() ?? {}),
	}

	return (
		<Page spacing={16}>
			<ScrollView>
				<Stack spacing={20} style={{ paddingBottom: 32 }}>
					<TableRowGroup title="Fix Link">
						<TableSwitchRow
							label="Corrigir links automaticamente"
							subLabel="Por enquanto, troca links do YouTube por Koutube antes de enviar."
							value={settings.enabled}
							onValueChange={enabled => void api.jsonStorage.set({ enabled })}
						/>
					</TableRowGroup>
				</Stack>
			</ScrollView>
		</Page>
	)
}
