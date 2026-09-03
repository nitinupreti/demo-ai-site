/*
 * Copyright 2026 Demo AI Site
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.day.cq.wcm.api.Page;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

@ExtendWith(AemContextExtension.class)
class FooterCtaModelTest {

    private static final String RT = "demo-ai-site/components/footer-cta";

    private final AemContext context = new AemContext();
    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(FooterCtaModel.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithCompleteData() {
        Resource r = context.create().resource(page, "cta",
                "sling:resourceType", RT,
                "title", "Let's talk!",
                "body", "We're ready to help.",
                "ctaLabel", "GET IN TOUCH",
                "ctaLink", "/content/demo-ai-site/us/en/contact");

        FooterCtaModel model = r.adaptTo(FooterCtaModel.class);

        assertNotNull(model);
        assertEquals("Let's talk!", model.getTitle());
        assertEquals("We're ready to help.", model.getBody());
        assertEquals("GET IN TOUCH", model.getCtaLabel());
        assertEquals("/content/demo-ai-site/us/en/contact.html", model.getCtaHref());
        assertTrue(model.isHasContent());
    }

    @Test
    void testEmpty() {
        Resource r = context.create().resource(page, "cta", "sling:resourceType", RT);
        FooterCtaModel model = r.adaptTo(FooterCtaModel.class);

        assertNotNull(model);
        assertNull(model.getTitle());
        assertNull(model.getBody());
        assertNull(model.getCtaHref());
        assertFalse(model.isHasContent());
    }

    @Test
    void testExternalCtaLinkNotSuffixed() {
        Resource r = context.create().resource(page, "cta",
                "sling:resourceType", RT,
                "ctaLabel", "Get in Touch",
                "ctaLink", "https://credera.com/en-in/contact");
        FooterCtaModel model = r.adaptTo(FooterCtaModel.class);

        assertNotNull(model);
        assertEquals("https://credera.com/en-in/contact", model.getCtaHref());
    }
}
