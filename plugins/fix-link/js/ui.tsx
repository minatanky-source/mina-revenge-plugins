import Page from '@revenge-mod/components/Page'
import { Design } from '@revenge-mod/discord/design'
import { ScrollView } from 'react-native'
import { DEFAULTS } from './state'
import type { FixLinkSettings } from './state'

const { Stack, TableRowGroup, TableSwitchRow } = Design

type ToggleKey = Exclude<keyof FixLinkSettings, 'enabled'>

const PLATFORMS: Array<{
	key: ToggleKey
	label: string
	provider: string
}> = [
	{ key: 'youtube', label: 'YouTube', provider: 'Koutube' },
	{ key: 'twitter', label: 'X / Twitter', provider: 'FxTwitter / FixupX' },
	{ key: 'instagram', label: 'Instagram', provider: 'OGInstagram' },
	{ key: 'tiktok', label: 'TikTok', provider: 'fxTikTok' },
	{ key: 'facebook', label: 'Facebook', provider: 'Facebed' },
	{ key: 'pinterest', label: 'Pinterest', provider: 'FixEmbed' },
	{ key: 'reddit', label: 'Reddit', provider: 'FixReddit' },
	{ key: 'threads', label: 'Threads', provider: 'FixThreads' },
	{ key: 'bluesky', label: 'Bluesky', provider: 'VixBluesky' },
	{ key: 'pixiv', label: 'Pixiv', provider: 'Phixiv' },
	{ key: 'twitch', label: 'Twitch', provider: 'fxTwitch' },
	{ key: 'tumblr', label: 'Tumblr', provider: 'FixEmbed' },
	{ key: 'deviantart', label: 'DeviantArt', provider: 'FixDeviantArt' },
	{ key: 'bilibili', label: 'Bilibili', provider: 'fxBilibili' },
]

export function SettingsComponent({ api }: any) {
	const settings: FixLinkSettings = {
		...DEFAULTS,
		...(api.jsonStorage.use() ?? {}),
	}

	const set = (update: Partial<FixLinkSettings>) => {
		void api.jsonStorage.set(update)
	}

	return (
		<Page spacing={16}>
			<ScrollView>
				<Stack spacing={20} style={{ paddingBottom: 32 }}>
					<TableRowGroup title="Fix Link">
						<TableSwitchRow
							label="Corrigir links automaticamente"
							subLabel="Troca links por versões com embeds melhores antes de enviar."
							value={settings.enabled}
							onValueChange={enabled => set({ enabled })}
						/>
					</TableRowGroup>

					<TableRowGroup title="Plataformas">
						{PLATFORMS.map(platform => (
							<TableSwitchRow
								key={platform.key}
								label={platform.label}
								subLabel={platform.provider}
								value={settings[platform.key]}
								onValueChange={value =>
									set({ [platform.key]: value } as Partial<FixLinkSettings>)
								}
							/>
						))}
					</TableRowGroup>
				</Stack>
			</ScrollView>
		</Page>
	)
}
