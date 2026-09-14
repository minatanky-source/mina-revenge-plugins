const ID = 'dev.minatanky.large-file-sender'

export interface NativePart {
	uri: string
	filename: string
	size: number
	index: number
	count: number
}

export interface SplitResult {
	split: boolean
	size: number
	sessionId?: string
	parts?: NativePart[]
}

function callNativeMethod(name: string, args: any[]): Promise<any> {
	return (revenge.modules.native as any).callNativeMethod(name, args)
}

export function splitFile(
	uri: string,
	filename: string,
	partSizeBytes: number,
): Promise<SplitResult> {
	return callNativeMethod(`${ID}.splitFile`, [uri, filename, partSizeBytes])
}

export function cleanupSession(sessionId: string): Promise<boolean> {
	return callNativeMethod(`${ID}.cleanupSession`, [sessionId])
}
