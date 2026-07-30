# Product Requirements Document (PRD)

## Google Search Console MCP Server

**Version:** 1.0\
**Project Codename:** GSC-MCP

## Overview

The Google Search Console MCP Server exposes Google Search Console data
through the Model Context Protocol (MCP), allowing AI agents such as
Antigravity, ChatGPT, Claude, Gemini, Cursor, and VS Code to query,
analyze, and optimize SEO performance using natural language.

The primary objective is to build a **Keyword ↔ Page Intelligence
Engine** that maps search queries to pages and provides actionable SEO
insights.

------------------------------------------------------------------------

# Goals

## Primary Goal

-   Build a searchable keyword-to-page intelligence layer from Google
    Search Console.

## Secondary Goals

-   AI-powered SEO recommendations
-   Historical keyword tracking
-   Page optimization insights
-   Technical SEO monitoring
-   Reporting and exports

------------------------------------------------------------------------

# Non-Goals

-   Competitor analysis
-   Backlink analysis
-   External keyword research
-   Website crawling
-   CMS integrations (v1)

------------------------------------------------------------------------

# Core Features

## Authentication

-   Google OAuth 2.0
-   Refresh token support
-   Multi-account support
-   Multi-property support
-   Secure credential storage

### MCP Tools

-   login()
-   logout()
-   list_accounts()
-   list_properties()
-   switch_property()

------------------------------------------------------------------------

# Property Management

Store

-   Site URL
-   Verification type
-   Permission level
-   Last sync time

------------------------------------------------------------------------

# Keyword Intelligence (Core)

Build a local searchable database of:

-   Keywords
-   Pages
-   Performance metrics
-   Historical snapshots

Each record contains:

-   Query
-   Page URL
-   Clicks
-   Impressions
-   CTR
-   Average Position
-   Country
-   Device
-   Search Type
-   Date

------------------------------------------------------------------------

# Keyword ↔ Page Mapping

## get_page_keywords(url)

Returns

-   Primary keyword
-   Secondary keywords
-   Clicks
-   Impressions
-   CTR
-   Position
-   Trend
-   Intent

## get_keyword_pages(keyword)

Returns

-   Ranking pages
-   Best page
-   Cannibalization detection
-   Historical performance

## build_keyword_index()

Creates the complete keyword-page relationship database.

------------------------------------------------------------------------

# Opportunity Engine

Automatically classify keywords into:

-   High impressions, low CTR
-   Position 4--10
-   Position 11--20
-   Lost keywords
-   New keywords
-   Growing keywords
-   Declining keywords
-   Brand keywords
-   Non-brand keywords
-   Zero-click keywords

------------------------------------------------------------------------

# AI SEO Intelligence

Generate

-   Search intent
-   SEO priority score
-   Suggested title
-   Suggested meta description
-   Suggested headings
-   Suggested FAQs
-   Internal linking suggestions
-   Schema recommendations

------------------------------------------------------------------------

# Page Intelligence

For every page:

-   SEO score
-   Primary keyword
-   Secondary keywords
-   Missing keywords
-   Keyword coverage
-   CTR trend
-   Optimization recommendations

------------------------------------------------------------------------

# Historical Tracking

Maintain daily snapshots for:

-   Clicks
-   Impressions
-   CTR
-   Average position

Support comparisons:

-   Yesterday
-   7 days
-   28 days
-   90 days
-   Year over year

------------------------------------------------------------------------

# Technical SEO

## URL Inspection

-   inspect_url()
-   bulk_inspect()

Return:

-   Index status
-   Canonical URL
-   Coverage
-   Last crawl
-   Rich results
-   Robots status

## Sitemaps

-   list_sitemaps()
-   submit_sitemap()
-   delete_sitemap()
-   sitemap_status()

------------------------------------------------------------------------

# Reports

Generate:

-   Daily reports
-   Weekly reports
-   Monthly reports
-   Keyword reports
-   Page reports
-   Executive summaries

Export:

-   Markdown
-   JSON
-   CSV

------------------------------------------------------------------------

# Database Schema

## sites

-   id
-   site_url
-   permission
-   verified
-   updated_at

## pages

-   id
-   site_id
-   url
-   title
-   clicks
-   impressions
-   ctr
-   position
-   total_keywords
-   last_synced

## keywords

-   id
-   query
-   intent
-   priority

## page_keywords

-   page_id
-   keyword_id
-   clicks
-   impressions
-   ctr
-   position
-   device
-   country
-   search_type
-   date

## snapshots

-   date
-   page_id
-   keyword_id
-   clicks
-   impressions
-   ctr
-   position

------------------------------------------------------------------------

# MCP Resources

-   searchconsole://properties
-   searchconsole://pages
-   searchconsole://keywords
-   searchconsole://reports
-   searchconsole://inspection
-   searchconsole://sitemaps
-   searchconsole://alerts

------------------------------------------------------------------------

# Built-in MCP Prompts

-   Analyze this page
-   Analyze this keyword
-   Find SEO opportunities
-   Find pages losing traffic
-   Explain traffic drop
-   Detect keyword cannibalization
-   Suggest content improvements

------------------------------------------------------------------------

# MVP Roadmap

## Phase 1

-   OAuth
-   Property selection
-   Search Analytics sync
-   Local database

## Phase 2

-   Keyword ↔ Page mapping
-   Historical snapshots
-   Opportunity engine

## Phase 3

-   AI SEO analysis
-   Reports
-   URL inspection
-   Sitemap management

## Phase 4

-   Alerts
-   Multi-site support
-   Integrations
