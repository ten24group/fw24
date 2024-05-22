import React from 'react';
import clsx from 'clsx';
import styles from './HomepageFeatures.module.css';

const FeatureList = [
  {
    title: 'Time To Launch',
    imgUrl: require('../../static/img/icon-time-to-launch.png').default,
    description: (
      <>
        Reduce time to launch by 3 to 4 months. Plan, build, deploy and test faster. 
      </>
    ),
  },
  {
    title: 'Build For Less',
    imgUrl: require('../../static/img/icon-build-for-less.png').default,
    description: (
      <>
        Save <strong>significant</strong> development costs with more flexibility for the future.
      </>
    ),
  },
  {
    title: 'Open Source',
    imgUrl: require('../../static/img/icon-open-source.png').default,
    description: (
      <>
        Available under the MIT license. 
        Customize and contribute without concerns about IP. 
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
