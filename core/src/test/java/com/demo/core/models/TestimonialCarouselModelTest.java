/*
 * Copyright 2026 Adobe Systems Incorporated
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 */
package com.demo.core.models;

import com.demo.core.testcontext.AppAemContext;
import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;
import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class TestimonialCarouselModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/tc-empty",
            "sling:resourceType", "demo-ai-site/components/testimonial-carousel");
        TestimonialCarouselModel m = r.adaptTo(TestimonialCarouselModel.class);
        assertNotNull(m);
        assertTrue(m.getItems().isEmpty());
        assertFalse(m.isHasItems());
        assertFalse(m.isHasContent());
    }

    @Test
    void withItems() {
        Resource r = context.create().resource("/content/test/tc-full",
            "sling:resourceType", "demo-ai-site/components/testimonial-carousel",
            "title", "Hear From Our Happy Clients");
        Resource items = context.create().resource(r, "items");
        context.create().resource(items, "item0",
            "profession", "Graphic Designer",
            "location", "Ontario, Canada",
            "quote", "Managing my taxes as a freelancer used to be overwhelming.",
            "authorName", "Taylor M., 28 years old",
            "authorImage", "/content/dam/demo-ai-site/taylor.jpg");
        context.create().resource(items, "item1",
            "profession", "Commercial Photographer",
            "location", "Ontario, Canada",
            "quote", "Noble Finance made everything effortless.",
            "authorName", "Jane D.");

        TestimonialCarouselModel m = r.adaptTo(TestimonialCarouselModel.class);
        assertNotNull(m);
        assertEquals("Hear From Our Happy Clients", m.getTitle());
        assertEquals(2, m.getItems().size());
        assertTrue(m.getItems().get(0).isHasAuthorImage());
        assertFalse(m.getItems().get(1).isHasAuthorImage());
        assertTrue(m.isHasItems());
        assertTrue(m.isHasContent());
    }
}
