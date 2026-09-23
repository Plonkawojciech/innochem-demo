-- Keep historical rules while allowing a current CMS URL to be reused.
ALTER TABLE redirects ADD COLUMN active boolean NOT NULL DEFAULT true;
