package com.demo.core.models;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import javax.annotation.PostConstruct;

import org.apache.sling.api.resource.Resource;
import org.apache.sling.models.annotations.DefaultInjectionStrategy;
import org.apache.sling.models.annotations.Model;
import org.apache.sling.models.annotations.injectorspecific.ChildResource;
import org.apache.sling.models.annotations.injectorspecific.ValueMapValue;

@Model(adaptables = Resource.class, defaultInjectionStrategy = DefaultInjectionStrategy.OPTIONAL)
public class FooterColumn {

    @ValueMapValue
    private String title;

    @ChildResource(name = "links")
    private List<Resource> linkResources;

    private List<NavItem> links;

    @PostConstruct
    protected void init() {
        links = new ArrayList<>();
        if (linkResources != null) {
            for (Resource itemResource : linkResources) {
                NavItem item = itemResource.adaptTo(NavItem.class);
                if (item != null && item.isHasContent()) {
                    links.add(item);
                }
            }
        }
    }

    public String getTitle() {
        return title;
    }

    public List<NavItem> getLinks() {
        return Collections.unmodifiableList(links);
    }

    public boolean isHasContent() {
        return (title != null && !title.isEmpty()) || !links.isEmpty();
    }
}
