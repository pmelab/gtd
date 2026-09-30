/** The document's own newline style, so a splice into a CRLF file never introduces a bare `\n`. */
export const eolOf = (content: string): "\r\n" | "\n" => (content.includes("\r\n") ? "\r\n" : "\n")
