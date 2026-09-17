/**
 * Helpers for the HTML composer. The editor owns one HTML string; the plain-text
 * alternative and the draft/send payloads are all derived from it, so there is
 * a single source of truth for what the message says.
 */

export const QUOTE_ATTRIBUTE = "data-mailflare-quote";
const QUOTE_OPEN = `<div class="mailflare-quote" ${QUOTE_ATTRIBUTE}="1">`;
const SIGNATURE_ATTRIBUTE = "data-mailflare-signature";

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

/** Plain text as HTML: escaped, with line breaks preserved. */
export function textToHtml(text: string | null | undefined): string {
	const value = (text ?? "").replace(/\r\n?/g, "\n");
	if (!value) return "";
	return `<div>${escapeHtml(value).replace(/\n/g, "<br>")}</div>`;
}

/** Wrap quoted or forwarded content so the composer and reader can fold it. */
export function wrapQuotedHtml(inner: string): string {
	return `${QUOTE_OPEN}${inner}</div>`;
}

/** Split a stored HTML body into the editable part and the folded quote, if any. */
export function splitQuotedHtml(html: string | null | undefined): { body: string; quoted: string | null } {
	const value = html ?? "";
	const index = value.indexOf(QUOTE_OPEN);
	if (index < 0) return { body: value, quoted: null };
	const inner = value.slice(index + QUOTE_OPEN.length).replace(/<\/div>\s*$/, "");
	return { body: value.slice(0, index), quoted: inner };
}

export function joinQuotedHtml(body: string, quoted: string | null): string {
	return quoted ? `${body}${wrapQuotedHtml(quoted)}` : body;
}

/** True when the HTML carries something other than empty blocks and whitespace. */
export function hasMeaningfulHtml(html: string): boolean {
	return htmlToPlainText(html).trim().length > 0 || /<img\b/i.test(html);
}

function signatureBlock(signature: string | null | undefined): string {
	const value = signature?.trim() ?? "";
	if (value.startsWith("DiscountRouter Sales Team")) return "<div data-mailflare-signature=\"1\"><br><br><table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" style=\"font-family:Arial,Helvetica,sans-serif;border-top:3px solid #7C4CFA;max-width:500px;width:100%;color:#151A42\"><tbody><tr><td style=\"padding:18px 16px 12px 0;width:64px;vertical-align:top\"><img src=\"https://mailflare.max-44e.workers.dev/discountrouter-logo.png\" width=\"64\" height=\"64\" alt=\"DiscountRouter\" style=\"display:block;border:0;border-radius:12px\"></td><td style=\"padding:18px 0 12px;vertical-align:top\"><div style=\"font-size:16px;font-weight:700;line-height:22px;color:#151A42\">DiscountRouter Sales Team</div><div style=\"font-size:12px;line-height:20px;color:#626A83\">Frontier models. Lower API costs.</div><div style=\"font-size:12px;line-height:22px\"><a href=\"mailto:sales@discountrouter.ai\" style=\"color:#5629F2;text-decoration:none\">sales@discountrouter.ai</a><br><a href=\"https://discountrouter.ai\" style=\"color:#5629F2;text-decoration:none\">discountrouter.ai</a></div></td></tr><tr><td colspan=\"2\" style=\"padding:10px 0 0;border-top:1px solid #E5D8FA;font-size:10px;line-height:15px;color:#767D92\">DiscountRouter is independent and is not affiliated with or endorsed by any model provider or tool maker.</td></tr></tbody></table></div>";
	return value ? `<div ${SIGNATURE_ATTRIBUTE}="1"><br><br>${textToHtml(value).replace(/^<div>|<\/div>$/g, "")}</div>` : "";
}

/** Swap or append the mailbox signature, mirroring the plain-text behaviour. */
export function applyMailboxSignatureHtml(
	html: string,
	previousSignature: string | null | undefined,
	nextSignature: string | null | undefined,
): string {
	const previousBlock = signatureBlock(previousSignature);
	const nextBlock = signatureBlock(nextSignature);
	if (previousBlock && html.includes(previousBlock)) return html.replace(previousBlock, nextBlock);
	if (!nextBlock || html.includes(nextBlock)) return html;
	return `${html}${nextBlock}`;
}

const BLOCK_TAGS = new Set(["p", "div", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "pre", "blockquote", "ul", "ol", "table"]);

/**
 * The text/plain alternative of a composed message. Blocks become lines, lists
 * get bullets or numbers, blockquotes get the classic "> " prefix so reply
 * chains stay readable in text-only clients and in Mailflare's own reader.
 */
export function htmlToPlainText(html: string | null | undefined): string {
	if (!html) return "";
	if (typeof DOMParser === "undefined") {
		return html.replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, "");
	}
	const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
	const text = renderNode(doc.body, { listDepth: 0, ordered: [] });
	return text.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

type RenderState = { listDepth: number; ordered: Array<number | null> };

function renderNode(node: Node, state: RenderState): string {
	if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\s+/g, " ");
	if (node.nodeType !== Node.ELEMENT_NODE) return "";
	const element = node as HTMLElement;
	const tag = element.tagName.toLowerCase();
	if (tag === "br") return "\n";
	if (tag === "style" || tag === "script" || tag === "head") return "";

	if (tag === "ul" || tag === "ol") {
		const next: RenderState = { listDepth: state.listDepth + 1, ordered: [...state.ordered, tag === "ol" ? 0 : null] };
		const items = Array.from(element.children)
			.map((child) => {
				const index = next.ordered.length - 1;
				if (next.ordered[index] !== null) next.ordered[index] = (next.ordered[index] ?? 0) + 1;
				const marker = next.ordered[index] !== null ? `${next.ordered[index]}. ` : "- ";
				const indent = "  ".repeat(state.listDepth);
				return `${indent}${marker}${renderChildren(child, next).trim()}`;
			})
			.join("\n");
		return `\n${items}\n`;
	}

	let inner = renderChildren(element, state);
	if (tag === "a") {
		const href = element.getAttribute("href") ?? "";
		if (href && href !== inner.trim() && !href.startsWith("mailto:")) inner = `${inner} (${href})`;
	}
	if (tag === "blockquote") {
		const quoted = inner
			.trim()
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n");
		return `\n${quoted}\n`;
	}
	if (BLOCK_TAGS.has(tag)) return `\n${inner}\n`;
	return inner;
}

function renderChildren(element: Element, state: RenderState): string {
	return Array.from(element.childNodes)
		.map((child) => renderNode(child, state))
		.join("");
}
