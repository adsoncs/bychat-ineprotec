import type { Story } from '@ladle/react'
import { Button, type ButtonProps } from './Button'

export default {
  title: 'UI / Button',
}

export const Variants: Story = () => (
  <div class="flex flex-wrap gap-3">
    <Button variant="primary">Primary</Button>
    <Button variant="secondary">Secondary</Button>
    <Button variant="ghost">Ghost</Button>
    <Button variant="danger">Danger</Button>
  </div>
)

export const Sizes: Story = () => (
  <div class="flex flex-wrap items-center gap-3">
    <Button size="sm">Small</Button>
    <Button size="md">Medium</Button>
    <Button size="lg">Large</Button>
  </div>
)

export const IconOnly: Story = () => (
  <div class="flex flex-wrap items-center gap-3">
    <Button size="sm" iconOnly aria-label="Buscar">⌕</Button>
    <Button size="md" iconOnly aria-label="Buscar">⌕</Button>
    <Button size="lg" iconOnly aria-label="Buscar">⌕</Button>
  </div>
)

export const Disabled: Story = () => (
  <div class="flex flex-wrap items-center gap-3">
    <Button disabled>Primary disabled</Button>
    <Button variant="secondary" disabled>Secondary disabled</Button>
  </div>
)

export const Playground: Story<ButtonProps> = (props) => <Button {...props}>Playground</Button>
Playground.args = { variant: 'primary', size: 'md', disabled: false }
Playground.argTypes = {
  variant: { options: ['primary', 'secondary', 'ghost', 'danger'], control: { type: 'select' }, defaultValue: 'primary' },
  size: { options: ['sm', 'md', 'lg'], control: { type: 'select' }, defaultValue: 'md' },
}
