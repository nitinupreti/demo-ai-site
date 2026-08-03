/*
 *  Copyright 2026 Adobe Systems Incorporated
 */
package com.demo.core.models;

import java.util.HashMap;
import java.util.Map;

import org.apache.sling.api.resource.Resource;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;

import com.demo.core.testcontext.AppAemContext;

import io.wcm.testing.mock.aem.junit5.AemContext;
import io.wcm.testing.mock.aem.junit5.AemContextExtension;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

@ExtendWith(AemContextExtension.class)
class CaseStudiesModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/cs-empty",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-case-studies"); }});
        CaseStudiesModel m = r.adaptTo(CaseStudiesModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
    }

    @Test
    void configuredFully() {
        Resource parent = context.create().resource("/content/test/cs-full",
                new HashMap<String, Object>() {{ put("sling:resourceType", "demo-ai-site/components/pos-case-studies"); }});
        Resource items = context.create().resource(parent.getPath() + "/items", new HashMap<>());
        Map<String, Object> i1 = new HashMap<>();
        i1.put("body", "For a local restaurant, we implemented a targeted PPC campaign.");
        i1.put("linkText", "Learn more");
        context.create().resource(items.getPath() + "/item0", i1);

        CaseStudiesModel m = parent.adaptTo(CaseStudiesModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(1, m.getItems().size());
        assertEquals("Learn more", m.getItems().get(0).getLinkText());
    }
}
