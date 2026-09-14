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
public class InsightsListModel {

    @ValueMapValue
    private String heading;

    @ChildResource(name = "people")
    private List<Resource> peopleResources;

    private List<InsightItem> people;

    @PostConstruct
    protected void init() {
        people = new ArrayList<>();
        if (peopleResources != null) {
            for (Resource itemResource : peopleResources) {
                InsightItem item = itemResource.adaptTo(InsightItem.class);
                if (item != null && item.isHasContent()) {
                    people.add(item);
                }
            }
        }
    }

    public String getHeading() {
        return heading;
    }

    public List<InsightItem> getPeople() {
        return Collections.unmodifiableList(people);
    }

    public boolean isHasContent() {
        return (heading != null && !heading.isEmpty()) || !people.isEmpty();
    }
}
