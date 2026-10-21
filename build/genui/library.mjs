// 小天's generative UI library, in OpenUI Lang (github.com/thesysdev/openui, MIT).
// Component names and arguments follow OpenUI's chat library so its prompt and examples carry over;
// the set is trimmed to what a personal agent's chat reply needs, plus Timeline and Files for 小天.
// Renderers live in tianxi/web/genui.js; here each component is only its props schema.
import { z } from 'zod/v4'
import { action, createLibrary, defineComponent } from '@openuidev/lang-core'

const C = (name, props, description) => defineComponent({ name, props: z.object(props), description, component: null })
const act = () => action().optional()

// fewer rules than OpenUI's, so the prompt stays short
const rules = z.object({ required: z.boolean().optional(), min: z.number().optional(), max: z.number().optional(), maxLength: z.number().optional() }).optional()

// ---- content ----
const CardHeader = C('CardHeader', { title: z.string().optional(), subtitle: z.string().optional() }, 'Title and subtitle at the top of a card')
const TextContent = C('TextContent', { text: z.string(), size: z.enum(['small', 'default', 'large', 'small-heavy', 'large-heavy']).optional() }, 'A paragraph; supports **bold** and `code`')
const Callout = C('Callout', { variant: z.enum(['info', 'warning', 'error', 'success', 'neutral']), title: z.string(), description: z.string() }, 'A highlighted note, warning or result')
const Separator = C('Separator', {}, 'A thin divider line')
const Image = C('Image', { alt: z.string(), src: z.string().optional() }, 'One image: an https URL or a local file path from a tool result')
const ImageGallery = C('ImageGallery', { images: z.array(z.object({ src: z.string(), alt: z.string().optional(), details: z.string().optional() })) }, 'A grid of images')
const TagBlock = C('TagBlock', { tags: z.array(z.string()), size: z.enum(['sm', 'md', 'lg']).optional() }, 'A row of small tags')
const Col = C('Col', { label: z.string(), data: z.any(), type: z.enum(['string', 'number']).optional() }, 'One table column: header label and its values, one per row')
const Table = C('Table', { columns: z.array(Col.ref) }, 'A column-oriented table')
const EntityRow = z.object({ left: z.string(), right: z.string(), rightVariant: z.enum(['text', 'number']).optional() })
const EntityList = C('EntityList', { rows: z.array(EntityRow), header: EntityRow.optional(), footer: EntityRow.optional() }, 'Label–value rows, like a receipt or a spec sheet; footer is the total line')
const Stat = C('Stat', { label: z.string(), value: z.string(), subtext: z.string().optional(), trend: z.object({ direction: z.enum(['up', 'down']), value: z.number() }).optional() }, 'One key number')
const StatBlock = C('StatBlock', { items: z.array(Stat.ref) }, 'Two to four key numbers side by side')

// ---- charts ----
const Series = C('Series', { category: z.string(), values: z.array(z.number()) }, 'One named data series')
const chart2D = { labels: z.array(z.string()), series: z.array(Series.ref), variant: z.enum(['grouped', 'stacked']).optional(), xLabel: z.string().optional(), yLabel: z.string().optional() }
const BarChart = C('BarChart', chart2D, 'Vertical bars; compare values across categories')
const HorizontalBarChart = C('HorizontalBarChart', chart2D, 'Horizontal bars; good for ranked lists with long labels')
const LineChart = C('LineChart', { labels: z.array(z.string()), series: z.array(Series.ref), variant: z.enum(['linear', 'natural', 'step']).optional(), xLabel: z.string().optional(), yLabel: z.string().optional() }, 'Lines over time')
const PieChart = C('PieChart', { labels: z.array(z.string()), values: z.array(z.number()), variant: z.enum(['pie', 'donut']).optional() }, 'Parts of a whole')

// ---- lists and steps ----
const ListItem = C('ListItem', { title: z.string(), subtitle: z.string().optional(), image: z.object({ src: z.string(), alt: z.string() }).optional(), actionLabel: z.string().optional(), action: act() }, 'One row of a ListBlock; clickable when it has an action')
const ListBlock = C('ListBlock', { items: z.array(ListItem.ref), variant: z.enum(['number', 'image']).optional() }, 'A list with numbers or images')
const StepsItem = C('StepsItem', { title: z.string(), details: z.string() }, 'One step')
const Steps = C('Steps', { items: z.array(StepsItem.ref) }, 'A numbered step-by-step guide')
const TimelineItem = C('TimelineItem', { time: z.string(), title: z.string(), subtitle: z.string().optional(), tag: z.string().optional(), conflict: z.boolean().optional() }, 'One event; time like "09:30" or "09:30–10:00"; conflict marks a clash')
const Timeline = C('Timeline', { items: z.array(TimelineItem.ref) }, 'A day or a trip in time order')
const Files = C('Files', { paths: z.array(z.string()) }, 'Local files you made or found, as clickable thumbnails (full paths from tool results only)')

// ---- actions ----
const Button = C('Button', { label: z.string(), action: act(), variant: z.enum(['primary', 'secondary', 'tertiary']).optional(), type: z.enum(['normal', 'destructive']).optional(), size: z.enum(['extra-small', 'small', 'medium', 'large']).optional() }, 'A button; with no action it sends its label to you as the user\'s reply')
const Buttons = C('Buttons', { buttons: z.array(Button.ref), direction: z.enum(['row', 'column']).optional() }, 'A group of buttons')
const FollowUpItem = C('FollowUpItem', { text: z.string() }, 'A suggested next question; clicking sends the text as the user\'s message')
const FollowUpBlock = C('FollowUpBlock', { items: z.array(FollowUpItem.ref) }, 'Two or three follow-up suggestions at the end of a response')

// ---- forms ----
const Input = C('Input', { name: z.string(), placeholder: z.string().optional(), type: z.enum(['text', 'email', 'password', 'number', 'url']).optional(), rules }, 'One-line text field')
const TextArea = C('TextArea', { name: z.string(), placeholder: z.string().optional(), rows: z.number().optional(), rules }, 'Multi-line text field')
const SelectItem = C('SelectItem', { value: z.string(), label: z.string() }, 'One option of a Select')
const Select = C('Select', { name: z.string(), items: z.array(SelectItem.ref), placeholder: z.string().optional(), rules }, 'Dropdown')
const DatePicker = C('DatePicker', { name: z.string(), mode: z.enum(['single', 'range']).optional(), rules }, 'Date, or a start and end date')
const Slider = C('Slider', { name: z.string(), variant: z.enum(['continuous', 'discrete']), min: z.number(), max: z.number(), step: z.number().optional(), defaultValue: z.array(z.number()).optional(), label: z.string().optional(), rules }, 'Pick a number in a range; label is the unit shown after the value, like "元" or "分钟"')
const CheckBoxItem = C('CheckBoxItem', { label: z.string(), description: z.string(), name: z.string(), defaultChecked: z.boolean().optional() }, 'One checkbox')
const CheckBoxGroup = C('CheckBoxGroup', { name: z.string(), items: z.array(CheckBoxItem.ref), rules }, 'Several checkboxes')
const RadioItem = C('RadioItem', { label: z.string(), description: z.string(), value: z.string() }, 'One radio option')
const RadioGroup = C('RadioGroup', { name: z.string(), items: z.array(RadioItem.ref), defaultValue: z.string().optional(), rules }, 'Pick one, with descriptions')
const SwitchItem = C('SwitchItem', { label: z.string().optional(), description: z.string().optional(), name: z.string(), defaultChecked: z.boolean().optional() }, 'One on/off switch')
const SwitchGroup = C('SwitchGroup', { name: z.string(), items: z.array(SwitchItem.ref) }, 'Several on/off switches')
const ChipItem = C('ChipItem', { value: z.string(), label: z.string() }, 'One chip')
const Chips = C('Chips', { name: z.string(), type: z.enum(['single', 'multiple']).optional(), items: z.array(ChipItem.ref), rules, defaultValue: z.union([z.string(), z.array(z.string())]).optional() }, 'Compact pills to pick one or several')
const OptionCard = C('OptionCard', { value: z.string(), title: z.string(), subtitle: z.string().optional() }, 'One selectable card')
const OptionCards = C('OptionCards', { name: z.string(), type: z.enum(['single', 'multiple']).optional(), items: z.array(OptionCard.ref), rules, defaultValue: z.union([z.string(), z.array(z.string())]).optional() }, 'Larger selectable cards with a title and subtitle, for choosing between plans')
const FormControl = C('FormControl', { label: z.string(), input: z.union([Input.ref, TextArea.ref, Select.ref, DatePicker.ref, Slider.ref, CheckBoxGroup.ref, RadioGroup.ref, SwitchGroup.ref, Chips.ref, OptionCards.ref]), hint: z.string().optional() }, 'A labelled field')
const Form = C('Form', { name: z.string(), buttons: Buttons.ref, fields: z.array(FormControl.ref) }, 'A form; its buttons send the filled values to you')

// ---- layout ----
const content = () => z.array(z.any())
const TabItem = C('TabItem', { value: z.string(), trigger: z.string(), content: content() }, 'value is unique id, trigger is tab label, content is array of components')
const Tabs = C('Tabs', { items: z.array(TabItem.ref) }, 'Tabbed container')
const AccordionItem = C('AccordionItem', { value: z.string(), trigger: z.string(), content: content() }, 'value is unique id, trigger is section title')
const Accordion = C('Accordion', { items: z.array(AccordionItem.ref) }, 'Collapsible sections')
const Stack = C('Stack', { children: content(), direction: z.enum(['row', 'column']).optional() }, 'Puts children side by side (row) or stacked (column)')
const Card = C('Card', { children: content() }, 'Vertical container for all content in a chat response. Children stack top to bottom.')

export const components = [
  Card, CardHeader, TextContent, Callout, Separator, Image, ImageGallery, TagBlock, Table, Col, EntityList, StatBlock, Stat,
  BarChart, HorizontalBarChart, LineChart, PieChart, Series,
  ListBlock, ListItem, Steps, StepsItem, Timeline, TimelineItem, Files,
  Buttons, Button, FollowUpBlock, FollowUpItem,
  Form, FormControl, Input, TextArea, Select, SelectItem, DatePicker, Slider, CheckBoxGroup, CheckBoxItem, RadioGroup, RadioItem, SwitchGroup, SwitchItem, Chips, ChipItem, OptionCards, OptionCard,
  Tabs, TabItem, Accordion, AccordionItem, Stack,
]

export const componentGroups = [
  { name: '内容', components: ['CardHeader', 'TextContent', 'Callout', 'Separator', 'Image', 'ImageGallery', 'TagBlock', 'EntityList', 'StatBlock', 'Stat'] },
  { name: '表格', components: ['Table', 'Col'] },
  { name: '图表', components: ['BarChart', 'HorizontalBarChart', 'LineChart', 'PieChart', 'Series'] },
  { name: '列表、步骤、时间', components: ['ListBlock', 'ListItem', 'Steps', 'StepsItem', 'Timeline', 'TimelineItem', 'Files'] },
  { name: '按钮', components: ['Buttons', 'Button', 'FollowUpBlock', 'FollowUpItem'] },
  {
    name: '表单', components: ['Form', 'FormControl', 'Input', 'TextArea', 'Select', 'SelectItem', 'DatePicker', 'Slider', 'CheckBoxGroup', 'CheckBoxItem', 'RadioGroup', 'RadioItem', 'SwitchGroup', 'SwitchItem', 'Chips', 'ChipItem', 'OptionCards', 'OptionCard'],
    notes: [
      '- Define EACH FormControl as its own reference — do NOT inline all controls in one array.',
      '- NEVER nest Form inside Form.',
      '- Form requires explicit buttons: Form(name, buttons, fields).',
      '- rules is an optional object: { required: true, min: 1 }. The renderer shows error messages itself.',
    ],
  },
  { name: '布局', components: ['Tabs', 'TabItem', 'Accordion', 'AccordionItem', 'Stack'] },
]

export const library = createLibrary({ root: 'Card', components, componentGroups })
