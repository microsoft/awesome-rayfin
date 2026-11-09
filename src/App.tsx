import {
  Badge,
  Button,
  Card,
  FluentProvider,
  Input,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  Select,
  Tab,
  TabList,
  Tooltip,
  webDarkTheme,
  webLightTheme,
} from '@fluentui/react-components';
import {
  ArrowLeftRegular,
  ArrowRightRegular,
  CheckmarkRegular,
  ClipboardRegular,
  CodeRegular,
  DatabaseRegular,
  DismissRegular,
  FlashRegular,
  KeyRegular,
  LayerRegular,
  OpenRegular,
  SearchRegular,
  ShareRegular,
  SparkleRegular,
  WeatherMoonRegular,
  WeatherSunnyRegular,
} from '@fluentui/react-icons';
import { useEffect, useMemo, useRef, useState } from 'react';
import templateData from './generated/templates.json';
import { ALL_FILTER, filterTemplates, uniqueSorted } from './lib/gallery';
import type { GalleryTemplate } from './types';

const templates = templateData as GalleryTemplate[];
const repositoryUrl = 'https://github.com/mksuni/awesome-rayfin';
const contributionGuideUrl = `${repositoryUrl}/blob/main/CONTRIBUTING.md`;
const templateProposalUrl =
  'https://github.com/microsoft/awesome-rayfin/issues/new?template=new-template-proposal.yml&labels=template';
const galleryCommand =
  'npm create @microsoft/rayfin -- --template https://github.com/mksuni/awesome-rayfin';
const fabricTrialUrl =
  'https://learn.microsoft.com/fabric/fundamentals/fabric-trial';
const templateAuthoringGuideUrl =
  'https://learn.microsoft.com/en-us/fabric/apps/author-templates';

type CopyStatus = { key: string; message: string; error: boolean } | null;
type ThemeMode = 'light' | 'dark';
type ScriptShell = 'bash' | 'powershell';

const serviceDetails = [
  { key: 'auth', label: 'Authentication' },
  { key: 'data', label: 'Data API' },
  { key: 'storage', label: 'Storage' },
  { key: 'staticHosting', label: 'Static hosting' },
] as const;

function bashQuote(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function powershellQuote(value: string) {
  return `'${value.replace(/'/g, "''")}'`;
}

function deploymentScript(template: GalleryTemplate, shell: ScriptShell) {
  const workspaceName = `rayfin-${template.id}`;

  if (shell === 'powershell') {
    return `# Install the Microsoft Fabric and Rayfin CLIs
python -m pip install --upgrade ms-fabric-cli
npm install --global @microsoft/rayfin-cli

# Set your Fabric tenant, capacity, and new workspace
$FabricTenantId = '<tenant-id>'
$FabricCapacityId = '<capacity-id>'
$FabricWorkspaceName = ${powershellQuote(workspaceName)}

# Sign in and create the workspace on your Fabric capacity
fab auth login
$PayloadPath = Join-Path $env:TEMP 'rayfin-workspace.json'
@{
  displayName = $FabricWorkspaceName
  capacityId = $FabricCapacityId
} | ConvertTo-Json | Set-Content $PayloadPath
$FabricWorkspaceId = fab api workspaces -X post -i $PayloadPath -q id
Remove-Item $PayloadPath

if (-not $FabricWorkspaceId) {
  throw 'Fabric workspace creation did not return a workspace ID.'
}

# Scaffold ${template.displayName} and deploy it with Rayfin
rayfin init my-rayfin-app -t ${powershellQuote(repositoryUrl)} --template-name ${powershellQuote(template.displayName)}
Set-Location my-rayfin-app
rayfin up --workspace-id $FabricWorkspaceId --tenant $FabricTenantId -y`;
  }

  return `# Install the Microsoft Fabric and Rayfin CLIs
python -m pip install --upgrade ms-fabric-cli
npm install --global @microsoft/rayfin-cli

# Set your Fabric tenant, capacity, and new workspace
export FABRIC_TENANT_ID='<tenant-id>'
export FABRIC_CAPACITY_ID='<capacity-id>'
export FABRIC_WORKSPACE_NAME=${bashQuote(workspaceName)}

# Sign in and create the workspace on your Fabric capacity
fab auth login
WORKSPACE_PAYLOAD="$(mktemp)"
printf '{"displayName":"%s","capacityId":"%s"}' \\
  "$FABRIC_WORKSPACE_NAME" "$FABRIC_CAPACITY_ID" > "$WORKSPACE_PAYLOAD"
export FABRIC_WORKSPACE_ID
FABRIC_WORKSPACE_ID="$(fab api workspaces -X post -i "$WORKSPACE_PAYLOAD" -q id)"
rm -f "$WORKSPACE_PAYLOAD"

if [ -z "$FABRIC_WORKSPACE_ID" ]; then
  echo 'Fabric workspace creation did not return a workspace ID.' >&2
  exit 1
fi

# Scaffold ${template.displayName} and deploy it with Rayfin
rayfin init my-rayfin-app -t ${bashQuote(repositoryUrl)} --template-name ${bashQuote(template.displayName)}
cd my-rayfin-app
rayfin up --workspace-id "$FABRIC_WORKSPACE_ID" --tenant "$FABRIC_TENANT_ID" -y`;
}

function initialTheme(): ThemeMode {
  let storedTheme: string | null = null;
  try {
    storedTheme = window.localStorage.getItem('awesome-rayfin-theme');
  } catch (error) {
    console.warn('Unable to read the saved theme preference.', error);
  }
  if (storedTheme === 'light' || storedTheme === 'dark') return storedTheme;
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function CopyButton({
  copyKey,
  text,
  label,
  copiedKey,
  onCopy,
  compact = false,
}: {
  copyKey: string;
  text: string;
  label: string;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  compact?: boolean;
}) {
  const copied = copiedKey === copyKey;

  return (
    <Button
      className={compact ? 'icon-button' : 'copy-button'}
      appearance="subtle"
      size="small"
      icon={copied ? <CheckmarkRegular /> : <ClipboardRegular />}
      onClick={() => onCopy(copyKey, text)}
      aria-label={copied ? 'Copied to clipboard' : label}
    >
      {!compact && <span>{copied ? 'Copied' : label}</span>}
    </Button>
  );
}

function ServiceIcon({ capability }: { capability: string }) {
  if (capability === 'Authentication') return <KeyRegular aria-hidden="true" />;
  if (capability === 'Data API') return <DatabaseRegular aria-hidden="true" />;
  if (capability === 'Microsoft Fabric') return <LayerRegular aria-hidden="true" />;
  return <FlashRegular aria-hidden="true" />;
}

function TemplateCard({
  template,
  copiedKey,
  onCopy,
  onShare,
  onView,
}: {
  template: GalleryTemplate;
  copiedKey: string | null;
  onCopy: (key: string, text: string) => void;
  onShare: (template: GalleryTemplate) => void;
  onView: (template: GalleryTemplate) => void;
}) {
  return (
    <Card
      role="article"
      className="template-card"
      id={`template-${template.id}`}
    >
      <div className="card-body">
        <div className="card-meta">
          <div className="stack-row">
            {template.stacks.map((stack) => (
              <Badge appearance="tint" key={stack}>{stack}</Badge>
            ))}
          </div>
          {template.experimental && (
            <Badge appearance="tint" color="warning">
              Experimental
            </Badge>
          )}
        </div>
        <div className="card-title-row">
          <div>
            <p className="eyebrow">{template.id}</p>
            <h3>{template.displayName}</h3>
          </div>
          <Tooltip content={`Copy link to ${template.displayName}`} relationship="label">
            <Button
              className="icon-button share-button"
              appearance="subtle"
              size="small"
              icon={<ShareRegular />}
              onClick={() => onShare(template)}
              aria-label={`Copy link to ${template.displayName}`}
            />
          </Tooltip>
        </div>

        <p className="card-description">{template.description}</p>

        <div className="capability-list" aria-label="Capabilities">
          {template.capabilities.map((capability) => (
            <Badge appearance="outline" className="capability" key={capability}>
              <ServiceIcon capability={capability} />
              {capability}
            </Badge>
          ))}
        </div>

        <div className="command-block">
          <div className="command-label">
            <span>Scaffold this template</span>
            <CopyButton
              copyKey={`template-${template.id}`}
              text={template.scaffoldCommand}
              label="Copy command"
              copiedKey={copiedKey}
              onCopy={onCopy}
              compact
            />
          </div>
          <code>
            <span aria-hidden="true">$</span> {template.scaffoldCommand}
          </code>
        </div>

        <div className="card-footer">
          <div className="card-footer-actions">
            <Button appearance="primary" size="small" onClick={() => onView(template)}>
              View details
            </Button>
            <a href={template.sourceUrl} target="_blank" rel="noreferrer">
              <CodeRegular aria-hidden="true" />
              View source
              <OpenRegular aria-hidden="true" />
            </a>
          </div>
          <span>{template.path}</span>
        </div>
      </div>
    </Card>
  );
}

function ArchitectureDiagram({ template }: { template: GalleryTemplate }) {
  const enabledServices = serviceDetails.filter(({ key }) => template.services[key]);

  return (
    <div
      className="architecture-diagram"
      role="img"
      aria-label={`${template.displayName} architecture: web application connects through Rayfin services to a Microsoft Fabric workspace`}
    >
      <div className="architecture-node architecture-app">
        <CodeRegular aria-hidden="true" />
        <div>
          <strong>{template.displayName}</strong>
          <span>{template.stacks.join(' + ')}</span>
        </div>
      </div>
      <span className="architecture-arrow" aria-hidden="true">→</span>
      <div className="architecture-services">
        <span>Rayfin services</span>
        <div>
          {enabledServices.map(({ key, label }) => (
            <Badge appearance="tint" key={key}>
              <ServiceIcon capability={label} />
              {label}
            </Badge>
          ))}
        </div>
      </div>
      <span className="architecture-arrow" aria-hidden="true">→</span>
      <div className="architecture-node architecture-fabric">
        <LayerRegular aria-hidden="true" />
        <div>
          <strong>Microsoft Fabric</strong>
          <span>Workspace + capacity</span>
        </div>
      </div>
    </div>
  );
}

function TemplateDetails({
  template,
  shell,
  copiedKey,
  onShellChange,
  onCopy,
  onBack,
}: {
  template: GalleryTemplate;
  shell: ScriptShell;
  copiedKey: string | null;
  onShellChange: (shell: ScriptShell) => void;
  onCopy: (key: string, text: string) => void;
  onBack: () => void;
}) {
  const script = deploymentScript(template, shell);
  const readmeUrl = `${repositoryUrl}/blob/main/${template.path}/README.md`;

  return (
    <article
      className="detail-page"
      id="template-detail"
      aria-labelledby={`detail-title-${template.id}`}
    >
      <div className="detail-page-topbar">
        <Button
          appearance="subtle"
          icon={<ArrowLeftRegular />}
          onClick={onBack}
        >
          Back to gallery
        </Button>
        <a href={template.sourceUrl} target="_blank" rel="noreferrer">
          View template source <OpenRegular aria-hidden="true" />
        </a>
      </div>

      <header className="detail-page-header">
        <p className="eyebrow">Template deployment guide</p>
        <h1 id={`detail-title-${template.id}`}>{template.displayName}</h1>
        <p>{template.description}</p>
        <div className="detail-badges">
          {template.stacks.map((item) => (
            <Badge appearance="tint" key={item}>{item}</Badge>
          ))}
          {template.capabilities.map((item) => (
            <Badge appearance="outline" key={item}>{item}</Badge>
          ))}
        </div>
      </header>

      <div className="detail-content">
            <section className="detail-section">
              <div className="detail-section-heading">
                <span>01</span>
                <div>
                  <h3>Architecture</h3>
                  <p>Services shown here are generated from this template's manifest.</p>
                </div>
              </div>
              <ArchitectureDiagram template={template} />
            </section>

            <section className="detail-section">
              <div className="detail-section-heading">
                <span>02</span>
                <div>
                  <h3>Before you deploy</h3>
                  <p>You need a Microsoft Fabric account, tenant access, and an active capacity.</p>
                </div>
              </div>
              <MessageBar intent="info" className="fabric-trial-message">
                <MessageBarBody>
                  <MessageBarTitle>New to Microsoft Fabric?</MessageBarTitle>
                  Start a free 60-day Fabric trial, then return with your tenant and
                  capacity IDs.
                  <a href={fabricTrialUrl} target="_blank" rel="noreferrer">
                    Start a free trial <OpenRegular aria-hidden="true" />
                  </a>
                </MessageBarBody>
              </MessageBar>
              <ol className="deployment-steps">
                <li>Install Node.js, Python 3.10+, the Fabric CLI, and the Rayfin CLI.</li>
                <li>Find your tenant ID and active Fabric capacity ID in the Fabric portal.</li>
                <li>Sign in with <code>fab auth login</code> and create a workspace on that capacity.</li>
                <li>Scaffold this template and run <code>rayfin up</code> against the returned workspace ID.</li>
              </ol>
            </section>

            <section className="detail-section deployment-section">
              <div className="detail-section-heading">
                <span>03</span>
                <div>
                  <h3>Deploy to Fabric</h3>
                  <p>Choose your shell, replace the placeholder IDs, then run the complete script.</p>
                </div>
              </div>
              <div className="script-toolbar">
                <TabList
                  selectedValue={shell}
                  onTabSelect={(_, data) =>
                    onShellChange(data.value === 'powershell' ? 'powershell' : 'bash')
                  }
                  aria-label="Deployment script shell"
                >
                  <Tab value="bash">Bash</Tab>
                  <Tab value="powershell">PowerShell</Tab>
                </TabList>
                <CopyButton
                  copyKey={`deploy-${template.id}-${shell}`}
                  text={script}
                  label={`Copy ${shell === 'bash' ? 'Bash' : 'PowerShell'} script`}
                  copiedKey={copiedKey}
                  onCopy={onCopy}
                />
              </div>
              <pre className="deployment-script" aria-label={`${shell} deployment script`}>
                <code>{script}</code>
              </pre>
              <p className="deployment-note">
                Some advanced templates provision additional Fabric items. Review the{' '}
                <a href={readmeUrl} target="_blank" rel="noreferrer">
                  template README
                </a>{' '}
                for any template-specific setup before deploying.
              </p>
            </section>
      </div>
    </article>
  );
}

export default function App() {
  const [query, setQuery] = useState('');
  const [capability, setCapability] = useState(ALL_FILTER);
  const [stack, setStack] = useState(ALL_FILTER);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>(null);
  const [themeMode, setThemeMode] = useState<ThemeMode>(initialTheme);
  const [selectedTemplate, setSelectedTemplate] = useState<GalleryTemplate | null>(null);
  const [scriptShell, setScriptShell] = useState<ScriptShell>('bash');
  const searchRef = useRef<HTMLInputElement>(null);
  const galleryScrollTargetRef = useRef<string | null>(null);

  const capabilities = useMemo(
    () => uniqueSorted(templates.map((template) => template.capabilities)),
    [],
  );
  const stacks = useMemo(
    () => uniqueSorted(templates.map((template) => template.stacks)),
    [],
  );
  const filteredTemplates = useMemo(
    () => filterTemplates(templates, { query, capability, stack }),
    [query, capability, stack],
  );

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    document.documentElement.style.colorScheme = themeMode;
    try {
      window.localStorage.setItem('awesome-rayfin-theme', themeMode);
    } catch (error) {
      console.warn('Unable to save the theme preference.', error);
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', themeMode === 'dark' ? '#07172d' : '#f5f5f5');
  }, [themeMode]);

  useEffect(() => {
    const syncTemplateFromLocation = () => {
      const targetId = window.location.hash.slice(1);
      const targetTemplate = targetId.startsWith('template-')
        ? templates.find((template) => `template-${template.id}` === targetId)
        : undefined;
      setSelectedTemplate(targetTemplate ?? null);
      if (targetTemplate) setScriptShell('bash');
    };

    syncTemplateFromLocation();
    window.addEventListener('hashchange', syncTemplateFromLocation);
    window.addEventListener('popstate', syncTemplateFromLocation);
    return () => {
      window.removeEventListener('hashchange', syncTemplateFromLocation);
      window.removeEventListener('popstate', syncTemplateFromLocation);
    };
  }, []);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (
        event.key === '/' &&
        !(event.target instanceof HTMLInputElement) &&
        !(event.target instanceof HTMLTextAreaElement)
      ) {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);

  useEffect(() => {
    if (!copyStatus) return;
    const timeout = window.setTimeout(() => setCopyStatus(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [copyStatus]);

  useEffect(() => {
    const targetId = galleryScrollTargetRef.current;
    if (!selectedTemplate && !targetId) return;

    const frame = window.requestAnimationFrame(() => {
      if (selectedTemplate) {
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
      } else if (targetId) {
        document.getElementById(targetId)?.scrollIntoView?.({ block: 'center' });
        galleryScrollTargetRef.current = null;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedTemplate]);

  const copyText = async (key: string, text: string, message = 'Command copied') => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus({ key, message, error: false });
    } catch {
      setCopyStatus({
        key: '',
        message: 'Clipboard access was blocked. Select and copy the command manually.',
        error: true,
      });
    }
  };

  const shareTemplate = (template: GalleryTemplate) => {
    const url = new URL(window.location.href);
    url.hash = `template-${template.id}`;
    void copyText(`share-${template.id}`, url.toString(), 'Template link copied');
  };

  const resetFilters = () => {
    setQuery('');
    setCapability(ALL_FILTER);
    setStack(ALL_FILTER);
    searchRef.current?.focus();
  };

  const viewTemplate = (template: GalleryTemplate) => {
    const url = new URL(window.location.href);
    url.hash = `template-${template.id}`;
    window.history.pushState({ galleryTemplate: template.id }, '', url);
    setScriptShell('bash');
    setSelectedTemplate(template);
  };

  const showGallery = (targetId?: string) => {
    const url = new URL(window.location.href);
    url.hash = '';
    window.history.replaceState(null, '', url);
    galleryScrollTargetRef.current = targetId ?? null;
    setSelectedTemplate(null);
  };

  const backToGallery = () => {
    showGallery(selectedTemplate ? `template-${selectedTemplate.id}` : 'templates');
  };

  return (
    <FluentProvider
      className="fluent-root"
      theme={themeMode === 'dark' ? webDarkTheme : webLightTheme}
    >
    <div className="app-shell">
      <a className="skip-link" href={selectedTemplate ? '#template-detail' : '#templates'}>
        Skip to {selectedTemplate ? 'template details' : 'templates'}
      </a>

      <header className="site-header">
        <a
          className="brand"
          href="#"
          aria-label="Awesome Rayfin home"
          onClick={
            selectedTemplate
              ? (event) => {
                  event.preventDefault();
                  showGallery();
                }
              : undefined
          }
        >
          <img src={`${import.meta.env.BASE_URL}gallery-mark.svg`} alt="" />
          <span>
            <strong>Awesome</strong> Rayfin
          </span>
          <span className="community-pill">Community</span>
        </a>

        <nav
          id="primary-navigation"
          className="nav-links"
          aria-label="Primary navigation"
        >
          <a
            className="nav-text-link"
            href="#templates"
            onClick={
              selectedTemplate
                ? (event) => {
                    event.preventDefault();
                    showGallery('templates');
                  }
                : undefined
            }
          >
            Templates
          </a>
          <a
            className="nav-text-link"
            href={templateAuthoringGuideUrl}
            target="_blank"
            rel="noreferrer"
          >
            How it works
          </a>
          <a className="nav-text-link" href={contributionGuideUrl} target="_blank" rel="noreferrer">
            Contribute
          </a>
          <Tooltip
            content={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`}
            relationship="label"
          >
            <Button
              className="theme-toggle"
              appearance="subtle"
              icon={themeMode === 'dark' ? <WeatherSunnyRegular /> : <WeatherMoonRegular />}
              onClick={() => setThemeMode((mode) => (mode === 'dark' ? 'light' : 'dark'))}
              aria-label={`Switch to ${themeMode === 'dark' ? 'light' : 'dark'} mode`}
            />
          </Tooltip>
          <a className="github-button" href={repositoryUrl} target="_blank" rel="noreferrer">
            <CodeRegular aria-hidden="true" />
            <span>GitHub</span>
          </a>
        </nav>
      </header>

      <main>
        {selectedTemplate ? (
          <TemplateDetails
            template={selectedTemplate}
            shell={scriptShell}
            copiedKey={copyStatus?.key ?? null}
            onShellChange={setScriptShell}
            onCopy={copyText}
            onBack={backToGallery}
          />
        ) : (
        <>
        <section className="hero">
          <div className="hero-glow glow-one" />
          <div className="hero-glow glow-two" />
          <div className="hero-grid" />

          <div className="hero-copy">
            <div className="hero-kicker">
              <SparkleRegular aria-hidden="true" />
              Community-built for Rayfin + Microsoft Fabric
            </div>
            <h1>
              Build apps    <span> faster with Rayfin.</span>
            </h1>
            <p>
              Discover production-minded starters, apps, and Fabric solutions built on
              Rayfin conventions. Pick a template and scaffold a working project in one
              command.
            </p>
            <div className="hero-actions">
              <a className="primary-action" href="#templates">
                Explore templates
                <ArrowRightRegular aria-hidden="true" />
              </a>
              <a className="secondary-action" href={contributionGuideUrl} target="_blank" rel="noreferrer">
                Submit your template
              </a>
              <a className="secondary-action" href={templateProposalUrl} target="_blank" rel="noreferrer">
                Propose a template
              </a>
            </div>
            <dl className="hero-stats">
              <div>
                <dt>{templates.length}</dt>
                <dd>Community templates</dd>
              </div>
              <div>
                <dt>{capabilities.length}</dt>
                <dd>Rayfin capabilities</dd>
              </div>
              <div>
                <dt>1</dt>
                <dd>Command to begin</dd>
              </div>
            </dl>
          </div>

          <div className="hero-cover" aria-label="Rayfin enterprise application platform">
            <img
              src={`${import.meta.env.BASE_URL}hero-enterprise.svg`}
              alt="Enterprise application interface connected to Rayfin services and Microsoft Fabric"
            />
            <div className="hero-cover-command">
              <div>
                <span>Start from a gallery template</span>
                <code>rayfin init my-app</code>
              </div>
              <CopyButton
                copyKey="hero-command"
                text={galleryCommand}
                label="Copy gallery command"
                copiedKey={copyStatus?.key ?? null}
                onCopy={copyText}
                compact
              />
            </div>
          </div>
        </section>
        <section className="gallery-section" id="templates">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Template explorer</p>
              <h2>Find your starting point</h2>
              <br/>
              <p>
                Search by use case or narrow the collection by Rayfin capability and
                application stack.
              </p>
            </div>
            <span className="result-count" aria-live="polite">
              {filteredTemplates.length} of {templates.length} templates
            </span>
          </div>

          <div className="filter-panel">
            <Input
              className="search-field"
              ref={searchRef}
              type="search"
              aria-label="Search templates"
              placeholder="Search templates, stacks, or capabilities..."
              value={query}
              contentBefore={<SearchRegular />}
              contentAfter={
                query ? (
                  <Button
                    appearance="subtle"
                    size="small"
                    icon={<DismissRegular />}
                    onClick={() => setQuery('')}
                    aria-label="Clear search"
                  />
                ) : (
                  <kbd>/</kbd>
                )
              }
              onChange={(_, data) => setQuery(data.value)}
            />

            <label className="select-field">
              <span>Stack</span>
              <Select value={stack} onChange={(_, data) => setStack(data.value)}>
                <option>{ALL_FILTER}</option>
                {stacks.map((item) => (
                  <option key={item}>{item}</option>
                ))}
              </Select>
            </label>
          </div>

          <div className="capability-filters" aria-label="Filter by capability">
            {[ALL_FILTER, ...capabilities].map((item) => (
              <Button
                key={item}
                appearance={capability === item ? 'primary' : 'subtle'}
                shape="circular"
                size="small"
                className={capability === item ? 'active' : ''}
                aria-pressed={capability === item}
                onClick={() => setCapability(item)}
              >
                {item}
              </Button>
            ))}
          </div>

          {filteredTemplates.length > 0 ? (
            <div className="template-grid">
              {filteredTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  copiedKey={copyStatus?.key ?? null}
                  onCopy={copyText}
                  onShare={shareTemplate}
                  onView={viewTemplate}
                />
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div><LayerRegular aria-hidden="true" /></div>
              <h3>No templates match yet</h3>
              <p>
                Try a broader search or reset the filters to explore the full gallery.
              </p>
              <Button appearance="primary" onClick={resetFilters}>
                Reset all filters
              </Button>
            </div>
          )}
        </section>

        <section className="workflow-section" id="how-it-works">
          <div className="section-heading workflow-heading">
            <div>
              <p className="eyebrow">Built the Rayfin way</p>
              <h2>From discovery to deployment</h2>
            </div>
          </div>
          <div className="workflow-grid">
            <article>
              <span>01</span>
              <SearchRegular aria-hidden="true" />
              <h3>Discover</h3>
              <p>Compare real apps by stack, service, and Fabric capability.</p>
            </article>
            <article>
              <span>02</span>
              <CodeRegular aria-hidden="true" />
              <h3>Scaffold</h3>
              <p>Copy a generated Rayfin CLI command for the exact template you want.</p>
            </article>
            <article>
              <span>03</span>
              <FlashRegular aria-hidden="true" />
              <h3>Ship</h3>
              <p>Build on typed Rayfin services and deploy through static hosting.</p>
            </article>
          </div>
        </section>
        </>
        )}
      </main>

      <footer>
        <a className="brand footer-brand" href="#">
          <img src={`${import.meta.env.BASE_URL}gallery-mark.svg`} alt="" />
          <span><strong>Awesome</strong> Rayfin</span>
        </a>
        <p>Community-curated templates for Project Rayfin and Microsoft Fabric.</p>
        <div>
          <a href={`${repositoryUrl}/blob/main/LICENSE`} target="_blank" rel="noreferrer">MIT License</a>
          <a href={repositoryUrl} target="_blank" rel="noreferrer">GitHub</a>
          <a href={contributionGuideUrl} target="_blank" rel="noreferrer">Contribute</a>
        </div>
      </footer>

      <div
        className={copyStatus ? `toast visible ${copyStatus.error ? 'toast-error' : ''}` : 'toast'}
        role="status"
        aria-live="polite"
      >
        {copyStatus?.error ? <DismissRegular aria-hidden="true" /> : <CheckmarkRegular aria-hidden="true" />}
        {copyStatus?.message}
      </div>
    </div>
    </FluentProvider>
  );
}
