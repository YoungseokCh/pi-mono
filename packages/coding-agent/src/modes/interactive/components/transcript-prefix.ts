import {
	type Component,
	type DefaultTextStyle,
	Markdown,
	type MarkdownTheme,
	visibleWidth,
} from "@mariozechner/pi-tui";

function stripMarkdownPadding(line: string): string {
	const withoutLeadingPadding = line.startsWith(" ") ? line.slice(1) : line;
	return withoutLeadingPadding.endsWith(" ") ? withoutLeadingPadding.slice(0, -1) : withoutLeadingPadding;
}

export function prefixTranscriptLines(lines: string[], prefix: string): string[] {
	const prefixPadding = " ".repeat(visibleWidth(prefix));
	return lines.map((line, index) => {
		const normalizedLine = stripMarkdownPadding(line);
		return index === 0 ? prefix + normalizedLine : prefixPadding + normalizedLine;
	});
}

export class PrefixedMarkdown implements Component {
	private markdown: Markdown;

	constructor(
		text: string,
		private prefix: string,
		markdownTheme: MarkdownTheme,
		defaultTextStyle?: DefaultTextStyle,
	) {
		this.markdown = new Markdown(text, 1, 0, markdownTheme, defaultTextStyle);
	}

	invalidate(): void {
		this.markdown.invalidate();
	}

	render(width: number): string[] {
		return prefixTranscriptLines(this.markdown.render(width), this.prefix);
	}
}
