import React from 'react';
import clsx from 'clsx';
import styles from './HomepageFeatures.module.css';

const FeatureList = [
  {
    title: 'Launch Faster',
    imgUrl: require('../../static/img/icon-time-to-launch.png').default,
    description: (
      <>
        Plan, build and deploy software applications faster. Start writing business logic on day one because the framework abstracts boilerplate code, significantly reducing start-up time and ongoing development. 
      </>
    ),
  },
  {
    title: 'Cost Efficiency',
    imgUrl: require('../../static/img/icon-build-for-less.png').default,
    description: (
      <>
        A serverless architecture can provide significant cost savings and Framework24 provides an opinionated design that makes development more streamlined and efficient, maximizing your resources.
      </>
    ),
  },
  {
    title: 'Open Source',
    imgUrl: require('../../static/img/icon-open-source.png').default,
    description: (
      <>
        Framework24 is available under the MIT license. Your team can customize and contribute without concerns about IP.
        The framework is currently in an Alpha Release.
      </>
    ),
  },
];

function Feature({imgUrl, title, description}) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        <img src={imgUrl} className={styles.featureImg} alt={title} />
      </div>
      <div className="text--center padding-horiz--md">
        <h3>{title}</h3>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures() {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
