const lightCodeTheme = require('prism-react-renderer/themes/github');
const darkCodeTheme = require('prism-react-renderer/themes/dracula');

// With JSDoc @type annotations, IDEs can provide config autocompletion
/** @type {import('@docusaurus/types').DocusaurusConfig} */
(module.exports = {
  title: 'Framework24 Documentation',
  tagline: 'A modern, serverless, framework to launch software products quickly and scale seamlessly',
  url: 'https://fw24.dev',
  baseUrl: '/',
  onBrokenLinks: 'throw',
  onBrokenMarkdownLinks: 'warn',
  favicon: 'img/favicon.ico',
  organizationName: 'Ten24 Group',
  projectName: 'fw24',

  presets: [
    [
      '@docusaurus/preset-classic',
      /** @type {import('@docusaurus/preset-classic').Options} */
      ({
        docs: {
          sidebarPath: require.resolve('./sidebars.js'),
          // Please change this to your repo.
          editUrl: 'https://github.com/ten24group/fw24/edit/main/www/',
        },
        theme: {
          customCss: require.resolve('./src/css/custom.css'),
        },
      }),
    ],
  ],

  themeConfig:
    /** @type {import('@docusaurus/preset-classic').ThemeConfig} */
    ({
      navbar: {
        title: 'fw24',
        logo: {
          alt: 'Framework24',
          src: 'img/logo.png',
        },
        items: [
          {
            type: 'doc',
            docId: 'Intro',
            position: 'left',
            label: 'Docs',
          },
          {
            href: 'https://github.com/ten24group/fw24',
            label: 'GitHub',
            position: 'right',
          },
        ],
      },
      footer: {
        style: 'dark',
        links: [
          {
            title: 'Docs',
            items: [
              {
                label: 'Docs',
                to: '/docs/intro',
              },
            ],
          },
          {
            title: 'Community',
            items: [
              {
                label: 'Stack Overflow',
                href: 'https://stackoverflow.com/questions/tagged/fw24',
              },
              {
                label: 'LinkedIn',
                href: 'https://linkedin.com/company/ten24',
              },
              {
                label: 'Twitter',
                href: 'https://twitter.com/fw24',
              },
            ],
          },
          {
            title: 'More',
            items: [
              {
                label: 'About Us',
                to: 'https://www.ten24.co',
              },
              {
                label: 'Contact Us',
                to: 'https://www.ten24.co/get-in-touch/',
              },
              {
                label: 'GitHub',
                href: 'https://github.com/ten24group/fw24',
              },
            ],
          },
        ],
        copyright: `Copyright © ${new Date().getFullYear()} Ten24 Group.`,
      },
      prism: {
        theme: lightCodeTheme,
        darkTheme: darkCodeTheme,
      },
    }),
});
