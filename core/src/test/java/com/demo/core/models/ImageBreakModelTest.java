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
class ImageBreakModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/ib-empty",
            "sling:resourceType", "demo-ai-site/components/image-break");
        ImageBreakModel m = r.adaptTo(ImageBreakModel.class);
        assertNotNull(m);
        assertEquals("md", m.getHeight());
        assertFalse(m.isHasContent());
    }

    @Test
    void configured() {
        Resource r = context.create().resource("/content/test/ib-full",
            "sling:resourceType", "demo-ai-site/components/image-break",
            "height", "lg");
        context.create().resource(r, "image",
            "sling:resourceType", "core/wcm/components/image/v3/image",
            "fileReference", "/content/dam/demo-ai-site/break.jpg");

        ImageBreakModel m = r.adaptTo(ImageBreakModel.class);
        assertNotNull(m);
        assertEquals("lg", m.getHeight());
        assertTrue(m.isHasContent());
    }
}
