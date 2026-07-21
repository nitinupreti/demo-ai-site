/*
 *  Copyright 2015 Adobe Systems Incorporated
 *
 *  Licensed under the Apache License, Version 2.0 (the "License");
 *  you may not use this file except in compliance with the License.
 *  You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
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
import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

/**
 * Unit tests for {@link HeroModel}.
 */
@ExtendWith(AemContextExtension.class)
class HeroModelTest {

    private static final String RESOURCE_TYPE = "demo-ai-site/components/hero";

    private final AemContext context = AppAemContext.newAemContext();

    private Page page;

    @BeforeEach
    void setUp() {
        context.addModelsForClasses(HeroModel.class);
        page = context.create().page("/content/demo-ai-site/test-page");
    }

    @Test
    void testWithCompleteData() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE,
                "asset", "/content/dam/demo-ai-site/hero.jpg",
                "backgroundColor", "dark",
                "title", "Welcome to Demo",
                "description", "Supporting description text",
                "ctaText", "Learn more",
                "ctaLink", "/content/demo-ai-site/en/about");

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertEquals("/content/dam/demo-ai-site/hero.jpg", model.getAsset());
        assertEquals("dark", model.getBackgroundColor());
        assertEquals("Welcome to Demo", model.getTitle());
        assertEquals("Supporting description text", model.getDescription());
        assertEquals("Learn more", model.getCtaText());
        assertEquals("/content/demo-ai-site/en/about", model.getCtaLink());
        assertTrue(model.isHasContent());
    }

    @Test
    void testBackgroundColorDefaultsToLight() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "Only title configured");

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertEquals("light", model.getBackgroundColor());
    }

    @Test
    void testWhenEmpty() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE);

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertNull(model.getTitle());
        assertNull(model.getAsset());
        assertNull(model.getDescription());
        assertNull(model.getCtaText());
        assertNull(model.getCtaLink());
        assertFalse(model.isHasContent());
    }

    @Test
    void testHasContent_WhenTitleBlank() {
        Resource resource = context.create().resource(page, "hero",
                "sling:resourceType", RESOURCE_TYPE,
                "title", "");

        HeroModel model = resource.adaptTo(HeroModel.class);

        assertNotNull(model);
        assertFalse(model.isHasContent());
    }

}
