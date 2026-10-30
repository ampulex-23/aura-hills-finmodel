// Блочный WYSIWYG-редактор поверх markdown (MDXEditor + Lexical).
// Markdown — источник истины: на выходе тот же .md, что сохраняем в git.
// Расширенные конструкции (KaTeX $$..$$, mermaid, raw HTML) редактор
// не понимает — для них DocPage включает режим исходника.
import '@mdxeditor/editor/style.css'
import {
  MDXEditor,
  headingsPlugin, listsPlugin, quotePlugin, thematicBreakPlugin,
  linkPlugin, linkDialogPlugin, imagePlugin, tablePlugin,
  codeBlockPlugin, codeMirrorPlugin, markdownShortcutPlugin,
  diffSourcePlugin, toolbarPlugin,
  UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle,
  CreateLink, InsertTable, InsertCodeBlock, InsertThematicBreak,
  DiffSourceToggleWrapper, Separator,
} from '@mdxeditor/editor'
import './mdeditor.css'

export function MdEditor({ value, onChange }: {
  value: string
  onChange: (md: string) => void
}) {
  return (
    <MDXEditor
      markdown={value}
      onChange={onChange}
      contentEditableClassName="mdx-content"
      plugins={[
        headingsPlugin(), listsPlugin(), quotePlugin(), thematicBreakPlugin(),
        linkPlugin(), linkDialogPlugin(), imagePlugin(), tablePlugin(),
        codeBlockPlugin({ defaultCodeBlockLanguage: '' }),
        codeMirrorPlugin({
          codeBlockLanguages: {
            '': 'Текст', bash: 'Bash', json: 'JSON', yaml: 'YAML',
            ts: 'TypeScript', js: 'JavaScript', python: 'Python',
            mermaid: 'Mermaid', typst: 'Typst',
          },
        }),
        markdownShortcutPlugin(),
        diffSourcePlugin({ viewMode: 'rich-text', diffMarkdown: '' }),
        toolbarPlugin({
          toolbarContents: () => (
            <DiffSourceToggleWrapper>
              <UndoRedo />
              <Separator />
              <BoldItalicUnderlineToggles />
              <Separator />
              <BlockTypeSelect />
              <ListsToggle />
              <Separator />
              <CreateLink />
              <InsertTable />
              <InsertCodeBlock />
              <InsertThematicBreak />
            </DiffSourceToggleWrapper>
          ),
        }),
      ]}
    />
  )
}
