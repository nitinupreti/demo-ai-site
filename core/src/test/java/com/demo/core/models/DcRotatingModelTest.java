/*
 * Copyright 2026 Demo AI Site
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
class DcRotatingModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/dr",
                "sling:resourceType", "demo-ai-site/components/dc-rotating");
        DcRotatingModel m = r.adaptTo(DcRotatingModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
        assertTrue(m.getItems().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource r = context.create().resource("/content/test/dr",
                "sling:resourceType", "demo-ai-site/components/dc-rotating",
                "prefix", "Washington, DC is our");
        context.create().resource(r.getPath() + "/items/i0",
                "word", "laboratory", "link", "/x",
                "image", "/content/dam/demo-ai-site/design/lab.jpg");
        context.create().resource(r.getPath() + "/items/i1",
                "word", "classroom", "link", "/y",
                "image", "/content/dam/demo-ai-site/design/classroom.jpg");
        DcRotatingModel m = r.adaptTo(DcRotatingModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(2, m.getItems().size());
        assertEquals("laboratory", m.getItems().get(0).getWord());
    }
}
