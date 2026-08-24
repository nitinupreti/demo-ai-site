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
class ProgramsSearchModelTest {

    private final AemContext context = AppAemContext.newAemContext();

    @Test
    void defaultsWhenEmpty() {
        Resource r = context.create().resource("/content/test/ps",
                "sling:resourceType", "demo-ai-site/components/programs-search");
        ProgramsSearchModel m = r.adaptTo(ProgramsSearchModel.class);
        assertNotNull(m);
        assertFalse(m.isHasContent());
        assertTrue(m.getPills().isEmpty());
        assertTrue(m.getSchools().isEmpty());
    }

    @Test
    void configuredFully() {
        Resource r = context.create().resource("/content/test/ps",
                "sling:resourceType", "demo-ai-site/components/programs-search",
                "heading", "Discover Your Future with AU",
                "statNumber", "91%",
                "statLabel", "of undergraduates are working within six months of graduation",
                "searchLabel", "Explore AU's academic offerings",
                "browseHeading", "Or browse by:");
        context.create().resource(r.getPath() + "/pills/p0", "label", "Undergraduate", "link", "/x");
        context.create().resource(r.getPath() + "/pills/p1", "label", "Graduate", "link", "/y");
        context.create().resource(r.getPath() + "/schools/s0", "name", "Kogod School of Business", "link", "/kogod");

        ProgramsSearchModel m = r.adaptTo(ProgramsSearchModel.class);
        assertNotNull(m);
        assertTrue(m.isHasContent());
        assertEquals(2, m.getPills().size());
        assertEquals(1, m.getSchools().size());
        assertEquals("Kogod School of Business", m.getSchools().get(0).getName());
    }
}
