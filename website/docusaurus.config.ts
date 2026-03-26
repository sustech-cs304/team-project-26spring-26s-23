import {themes as prismThemes} from 'prism-react-renderer';
import type {Config} from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';

// This runs in Node.js - Don't use client-side code here (browser APIs, JSX...)

const config: Config = {
  title: '赶渡 GanDue',
  tagline: 'SUSTech 学生课程管理与智能助手项目文档',
  favicon: 'img/candue_icon.png',

  future: {
    v4: true, 
  },

  url: 'https://sustech-cs304.github.io',
  baseUrl: '/team-project-26spring-26s-23/',

  organizationName: 'sustech-cs304',
  projectName: 'team-project-26spring-26s-23',

  onBrokenLinks: 'throw',

  i18n: {
    defaultLocale: 'zh-Hans',
    locales: ['zh-Hans'],
  },

  presets: [
    [
      'classic',
      {
        docs: {
          path: '../docs',
          routeBasePath: '/',
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: {
          customCss: './src/css/custom.css',
        },
      } satisfies Preset.Options,
    ],
  ],

  themeConfig: {
    colorMode: {
      respectPrefersColorScheme: true,
    },
    navbar: {
      title: '赶渡 GanDue',
      logo: {
        alt: 'GanDue Logo',
        src: 'img/candue_icon.png',
      },
      items: [
        {
          type: 'docSidebar',
          sidebarId: 'tutorialSidebar',
          position: 'left',
          label: '文档',
        },
        {
          href: 'https://github.com/sustech-cs304/team-project-26spring-26s-23',
          label: 'GitHub',
          position: 'right',
        },
      ],
    },
    footer: {
      style: 'dark',
      links: [
        {
          title: '文档',
          items: [
            {
              label: '开始阅读',
              to: '/',
            },
          ],
        },
        {
          title: '社区',
          items: [
            {
              label: 'GitHub',
              href: 'https://github.com/sustech-cs304/team-project-26spring-26s-23',
            },
          ],
        },
      ],
      copyright: `Copyright © ${new Date().getFullYear()} SUSTech CS304 Team 26s-23. Built with Docusaurus.`,
    },
    prism: {
      theme: prismThemes.github,
      darkTheme: prismThemes.dracula,
    },
  } satisfies Preset.ThemeConfig,
};

export default config;