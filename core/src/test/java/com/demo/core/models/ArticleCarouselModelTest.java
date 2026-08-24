/*
 * Copyright 2024 Adobe Systems Incorporated
 * Licensed under the Apache License, Version 2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.*;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class ArticleCarouselModelTest {

    private final AemContext ctx = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource res = ctx.create().resource("/content/ac-empty",
                "sling:resourceType", "demo-ai-site/components/article-carousel");
        ArticleCarouselModel m = res.adaptTo(ArticleCarouselModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
                assertFalse(m.isHasFeatured());
                assertNull(m.getFeatured());
        assertTrue(m.getArticles().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource root = ctx.create().resource("/content/ac",
                "sling:resourceType", "demo-ai-site/components/article-carousel",
                "headingEmphasis", "Webinars, articles,",
                "heading", "and customer stories");
        ctx.create().resource(root, "featured",
                "title", "Featured story",
                "quote", "Featured quote",
                "attribution", "Researcher",
                "ctaLabel", "READ MORE",
                "ctaLink", "/content/featured",
                "image", "/content/dam/featured.webp",
                "imageAlt", "Featured story image");
        Resource articles = ctx.create().resource(root, "articles");
        ctx.create().resource(articles, "item0",
                "title", "Infectious disease solutions", "description", "d",
                "ctaLabel", "LEARN MORE", "ctaLink", "#");
        ctx.create().resource(articles, "item1",
                "title", "Oligo quantification", "description", "d",
                "ctaLabel", "READ", "ctaLink", "#");

        ArticleCarouselModel m = root.adaptTo(ArticleCarouselModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
                assertEquals("Webinars, articles,", m.getHeadingEmphasis());
                assertEquals("and customer stories", m.getHeading());
                assertTrue(m.isHasFeatured());
                assertEquals("Featured story", m.getFeatured().getTitle());
                assertEquals("Featured quote", m.getFeatured().getQuote());
                assertEquals("Researcher", m.getFeatured().getAttribution());
                assertEquals("READ MORE", m.getFeatured().getCtaLabel());
                assertEquals("/content/featured", m.getFeatured().getCtaLink());
                assertEquals("/content/dam/featured.webp", m.getFeatured().getImage());
                assertEquals("Featured story image", m.getFeatured().getImageAlt());
        assertEquals(2, m.getArticles().size());
    }
}
