import React from 'react';
import clsx from 'clsx';
import Layout from '@theme/Layout';
import Link from '@docusaurus/Link';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import styles from './index.module.css';
import HomepageFeatures from '../components/HomepageFeatures';
import CodeBlock from '@theme/CodeBlock';

function HomepageHeader() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <header className={clsx('hero hero--primary', styles.heroBanner)}>
      <div className="container">
        <p className="hero__subtitle">A modern serverless framework to launch software <br />
        products quickly and scale seamlessly</p>
        <div className='code-home'>
          <CodeBlock className="language-bash">
            {"npm i -g @ten24group/cli24\ncli24 generate-sample-project myapp"}
          </CodeBlock>
        </div>
        <div className={styles.buttons}>
          <Link
            className="button button--secondary button--lg"
            to="/docs/Intro">
            View Documentation
          </Link>
        </div>
      </div>
    </header>
  );
}

function TopBanner() {
  return (
    <div className="top-banner">
      <div className="container">
        <div className={styles.buttons}>
          <img src="img/logo-framework24.jpg" alt="Framework24" width="400px" />
        </div>
      </div>
    </div>
  );
} 

export default function Home() {
  const {siteConfig} = useDocusaurusContext();
  return (
    <Layout
      title={`${siteConfig.title}`}
      description="A modern, serverless, framework to launch software products quickly and scale seamlessly">
      <TopBanner />
      <HomepageHeader />
      <main>
        <HomepageFeatures />
      </main>
    </Layout>
  );
}
