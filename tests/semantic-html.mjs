const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')
const uri = value => escape(encodeURI(value).replace(/%25([a-f\d]{2})/gi, '%$1'))
const title = value => value === null ? '' : ` title="${escape(value)}"`

function inline(node) {
  switch (node.type) {
    case 'text': return escape(node.value)
    case 'code': return `<code>${escape(node.value)}</code>`
    case 'html': return node.value
    case 'break': return node.hard ? '<br />\n' : '\n'
    case 'emphasis': return `<em>${inlines(node.children)}</em>`
    case 'strong': return `<strong>${inlines(node.children)}</strong>`
    case 'delete': return `<del>${inlines(node.children)}</del>`
    case 'link': return `<a href="${uri(node.url)}"${title(node.title)}>${inlines(node.children)}</a>`
    case 'image': return `<img src="${uri(node.url)}" alt="${escape(node.alt)}"${title(node.title)} />`
    default: throw new TypeError(`Unsupported semantic inline ${node.type}`)
  }
}
const inlines = nodes => nodes.map(inline).join('')

function item(node, loose) {
  const children = node.children.map((child, index) => {
    let rendered = block(child, !loose)
    if (index === 0 && node.checked !== null) {
      const checkbox = `<input${node.checked ? ' checked=""' : ''} disabled="" type="checkbox"> `
      rendered = loose ? rendered.replace('<p>', `<p>${checkbox}`) : checkbox + rendered
    }
    if (!loose && child.type === 'paragraph' && index < node.children.length - 1) rendered += '\n'
    return rendered
  }).join('')
  const start = node.children.length > 0 && (loose || node.children[0]?.type !== 'paragraph') ? '\n' : ''
  return `<li>${start}${children}</li>\n`
}
function table(node) {
  const row = (cells, tag) => '<tr>\n' + cells.map((cell, index) => {
    const alignment = node.align[index] ? ` align="${node.align[index]}"` : ''
    return `<${tag}${alignment}>${inlines(cell.children)}</${tag}>\n`
  }).join('') + '</tr>\n'
  let value = '<table>\n<thead>\n' + row(node.rows[0].cells, 'th') + '</thead>\n'
  if (node.rows.length > 1) value += '<tbody>\n' + node.rows.slice(1).map(value => row(value.cells, 'td')).join('') + '</tbody>\n'
  return value + '</table>\n'
}
function block(node, tight = false) {
  switch (node.type) {
    case 'paragraph': return tight ? inlines(node.children) : `<p>${inlines(node.children)}</p>\n`
    case 'heading': return `<h${node.depth}>${inlines(node.children)}</h${node.depth}>\n`
    case 'quote': return `<blockquote>\n${blocks(node.children)}</blockquote>\n`
    case 'thematicBreak': return '<hr />\n'
    case 'code': {
      const language = node.language ? ` class="language-${escape(node.language)}"` : ''
      return `<pre><code${language}>${escape(node.value)}${node.value ? '\n' : ''}</code></pre>\n`
    }
    case 'html': return node.value + (node.value.endsWith('\n') ? '' : '\n')
    case 'definition': return ''
    case 'list': {
      const tag = node.ordered ? 'ol' : 'ul'
      const start = node.ordered && node.start !== 1 ? ` start="${node.start}"` : ''
      return `<${tag}${start}>\n${node.items.map(value => item(value, node.spread || value.spread)).join('')}</${tag}>\n`
    }
    case 'table': return table(node)
    default: throw new TypeError(`Unsupported semantic block ${node.type}`)
  }
}
const blocks = nodes => nodes.map(value => block(value)).join('')
export const semanticHtml = snapshot => blocks(snapshot.root.children)
