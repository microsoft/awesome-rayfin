---
Title: Home
---

# Home

This is a documentation site built with [Zensical](https://zensical.org) and hosted on
Microsoft Fabric via [Rayfin](https://github.com/microsoft/rayfin).

## Getting Started

Add your Markdown pages to the `docs/` folder and update `zensical.toml` to configure
the site name, URL, navigation, and theme.

Run locally:

```bash
npm run dev
```

Build for deployment:

```bash
npm run build
```

Deploy to Microsoft Fabric:

```bash
npm run up
```

## Markdown Demo

Zensical has documentation on [markdown features](https://zensical.org/docs/authoring/markdown/). Here are some highlights.

Some text with **bold**, *italic*, and a [hyperlink](https://github.com/microsoft/rayfin).

### Code

Inline code: `#!bash npm run build`

Code blocks with syntax highlighting:

```bash title="Build the site"
npm run build
```

```python title="Example Python snippet"
def greet(name: str) -> str:
    return f"Hello, {name}!"
```

### Tabs

=== "npm"

    ```bash
    npm run dev
    ```

=== "npx"

    ```bash
    npx zensical serve
    ```

### Admonitions

!!! info "Info"

    Use admonitions to call out important information.

!!! warning "Warning"

    This is a warning admonition.

??? note "Collapsed note"

    This content is collapsed by default.
