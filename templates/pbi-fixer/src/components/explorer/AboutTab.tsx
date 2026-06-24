// AboutTab — "About" surface for the Power BI Fixer Rayfin app.
//
// Mirrors the Developer Hub's About page: a lightweight surface with
// version info, the people behind the project, acknowledgements and
// links to source / docs / license. Reachable from the bottom-left of
// the navigation, like the Developer Hub shell footer.

import {
  makeStyles,
  shorthands,
  tokens,
  Title2,
  Title3,
  Subtitle2,
  Body1,
  Body1Strong,
  Link,
  Divider,
} from '@fluentui/react-components';
import { Open16Regular } from '@fluentui/react-icons';

// Bumped manually with notable releases. Shown as a badge in the hero.
export const APP_VERSION = '1.0.0';

const useStyles = makeStyles({
  root: {
    height: '100%',
    overflowY: 'auto',
    backgroundColor: tokens.colorNeutralBackground1,
  },
  inner: {
    maxWidth: '780px',
    marginInline: 'auto',
    paddingBlock: '32px 48px',
    paddingInline: '32px',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '20px',
  },
  hero: { display: 'flex', flexDirection: 'column', rowGap: '8px' },
  tagline: { color: tokens.colorNeutralForeground2 },
  versionRow: {
    display: 'flex',
    flexWrap: 'wrap',
    columnGap: '12px',
    rowGap: '8px',
    marginTop: '4px',
  },
  badge: {
    display: 'inline-flex',
    alignItems: 'center',
    columnGap: '6px',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
    fontSize: '12px',
    color: tokens.colorNeutralForeground2,
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.border('1px', 'solid', tokens.colorNeutralStroke2),
    ...shorthands.borderRadius('4px'),
    ...shorthands.padding('3px', '8px'),
  },
  section: { display: 'flex', flexDirection: 'column', rowGap: '8px' },
  list: {
    margin: 0,
    paddingLeft: '20px',
    display: 'flex',
    flexDirection: 'column',
    rowGap: '6px',
  },
  inlineLink: { display: 'inline-flex', alignItems: 'center', columnGap: '4px' },
  footnote: { color: tokens.colorNeutralForeground3, fontSize: tokens.fontSizeBase200 },
});

export function AboutTab() {
  const styles = useStyles();
  return (
    <div className={styles.root}>
      <div className={styles.inner}>
        {/* Hero */}
        <div className={styles.hero}>
          <Title2>Power BI Fixer</Title2>
          <Body1 className={styles.tagline}>
            A Microsoft Fabric app that bundles Power BI productivity tools, semantic-model
            utilities, and report fixers into a single editor surface, powered server-side by
            Fabric User Data Functions.
          </Body1>
          <div className={styles.versionRow}>
            <span className={styles.badge}>Power BI Fixer {APP_VERSION}</span>
          </div>
        </div>

        <Divider />

        {/* Authors */}
        <section className={styles.section}>
          <Title3>Authors</Title3>
          <ul className={styles.list}>
            <li>
              <Body1Strong>Alexander Korn</Body1Strong>
              <Body1> — creator &amp; maintainer. LinkedIn: https://www.linkedin.com/in/alexanderkorn/</Body1>
            </li>
          </ul>
        </section>

        {/* Acknowledgements */}
        <section className={styles.section}>
          <Title3>Acknowledgements</Title3>
          <ul className={styles.list}>
            <li>
              <Body1Strong>Lukasz Obst</Body1Strong>
              <Body1> — for his contributions to the project. LinkedIn: https://www.linkedin.com/in/lukasz-obst-3672083a2/</Body1>
            </li>
            <li>
              <Body1Strong>Michael Kovalsky</Body1Strong>
              <Body1>
                {' '}
                — for{' '}
                <Link
                  href="https://github.com/microsoft/semantic-link-labs"
                  target="_blank"
                  rel="noreferrer"
                  className={styles.inlineLink}
                >
                  semantic-link-labs <Open16Regular />
                </Link>
                , whose Python utilities (Vertipaq Analyzer, BPA helpers, TMDL round-trips)
                inspired several Power BI Fixer features.
              </Body1>
            </li>
            <li>
              <Body1>The </Body1>
              <Link
                href="https://learn.microsoft.com/fabric/workload-development-kit/development-kit-overview"
                target="_blank"
                rel="noreferrer"
                className={styles.inlineLink}
              >
                Microsoft Fabric Workload Development Kit <Open16Regular />
              </Link>
              <Body1> team — for the platform this app is built on.</Body1>
            </li>
            <li>
              <Body1>The </Body1>
              <Link
                href="https://react.fluentui.dev/"
                target="_blank"
                rel="noreferrer"
                className={styles.inlineLink}
              >
                Fluent UI v9 <Open16Regular />
              </Link>
              <Body1> team — for the design system and component library.</Body1>
            </li>
          </ul>
        </section>

        {/* Resources */}
        <section className={styles.section}>
          <Title3>Resources</Title3>
          <ul className={styles.list}>
            <li>
              <Link
                href="https://github.com/LukaszObst/fabric_developer_hub"
                target="_blank"
                rel="noreferrer"
                className={styles.inlineLink}
              >
                GitHub repository <Open16Regular />
              </Link>
            </li>
            <li>
              <Link
                href="https://github.com/LukaszObst/fabric_developer_hub/blob/main/LICENSE"
                target="_blank"
                rel="noreferrer"
                className={styles.inlineLink}
              >
                License (MIT) <Open16Regular />
              </Link>
            </li>
          </ul>
        </section>

        <Divider />

        <Subtitle2 className={styles.footnote}>Built for and inside Microsoft Fabric.</Subtitle2>
      </div>
    </div>
  );
}

export default AboutTab;
