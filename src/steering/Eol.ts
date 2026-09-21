/** The document's own newline style — `"\r\n"` when `content` contains any CRLF, otherwise `"\n"`. Shared by every writer that splices new bytes into an existing document, so a splice into a CRLF file never introduces a bare `\n`. */
export const eolOf = (content: string): "\r\n" | "\n" => (content.includes("\r\n") ? "\r\n" : "\n")
