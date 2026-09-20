/**
 * Every word on the site, loaded from src/content/*.yml.
 *
 * Those files are the ones the CMS at /admin reads and writes: a partner saving
 * an edit commits a new version of one of them, and the Pages deploy rebuilds
 * these pages from it. Keep the shapes here in step with public/admin/config.yml
 * — that file describes the same fields to the editor.
 */
import siteData from '../content/site.yml';
import homeData from '../content/home.yml';
import ideaData from '../content/idea.yml';
import practiceData from '../content/practice.yml';
import joinData from '../content/join.yml';

export interface NavLink {
  label: string;
  href: string;
  highlight?: boolean;
}

export interface Site {
  meta_description: string;
  header: {
    wordmark: string;
    links: NavLink[];
  };
}

/** One paragraph-shaped thing in a deck page's 70ch column. */
export type ProseBlock =
  | { type: 'opener' | 'lead' | 'heading' | 'text' | 'pull' | 'footnote'; text: string }
  | { type: 'list'; items: string[] };

export interface DeckPage {
  page_title: string;
  title_lines: string[];
  kicker: string;
  blocks: ProseBlock[];
  links: NavLink[];
}

export interface HomePage {
  page_title: string;
  title_lines: string[];
  tagline: string;
  creed: string;
  panels: { number: string; title: string; blurb: string; cta: string; href: string }[];
  footer: { mark: string; link_label: string; link_href: string };
}

export type JoinIntroBlock =
  | { type: 'text'; text: string }
  | { type: 'pledge'; lines: string[] };

export interface JoinPage {
  page_title: string;
  title_lines: string[];
  kicker: string;
  intro: JoinIntroBlock[];
  form: {
    name_label: string;
    email_label: string;
    contribution_label: string;
    contribution_placeholder: string;
    contributions: string[];
    message_label: string;
    submit_label: string;
  };
  thanks: string;
  back_label: string;
}

export const site = siteData as Site;
export const home = homeData as HomePage;
export const idea = ideaData as DeckPage;
export const practice = practiceData as DeckPage;
export const join = joinData as JoinPage;
